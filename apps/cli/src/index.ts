#!/usr/bin/env bun
import React from 'react';
import { render } from '@claude-code-kit/ink-renderer';
import * as path from 'path';
import * as os from 'os';
import cliPkg from '../package.json';
import {
  DependencyRegistry,
  AgentCore,
  ConfigManager,
  FileSessionStore,
  FileLogger,
  OpenAICompatibleLLMService,
  DockerProcessRunner,
  resolveWorkspaceHistoryDir,
} from '@ak-coder/core';
import { NodeFileSystem } from './adapters/filesystem';
import { NodeTerminalIo } from './adapters/terminal';
import { NodeProcessRunner } from './adapters/process';
import { StdioJsonRpcAdapter } from './adapters/stdio';
import { REPL_COMMAND_NAMES } from './repl';
import { writePlanFile } from './plan-file';
import { InkTerminalIo } from './ui/InkTerminalIo';
import { App } from './ui/App';
import { initDebug, isDebugEnabled } from './debug';

// Global Error Boundary to prevent leaving terminal raw mode broken on crash
function registerCrashBoundary() {
  process.on('uncaughtException', (err) => {
    try {
      // Reset terminal styles and show cursor
      process.stdout.write('\x1b[?25h\x1b[0m\n');
      console.error('\x1b[31m[ak-coder fatal crash boundary reached]\x1b[0m');
      console.error(err.stack || err.message);
    } catch {}
    process.exit(1);
  });
}

async function run() {
  registerCrashBoundary();

  const workspaceRoot = process.cwd();
  const homeDir = os.homedir();
  const globalConfigDir = path.join(homeDir, '.ak-coder');
  const localConfigDir = path.join(workspaceRoot, '.ak-coder');

  // Check command line flags before creating any stdin-consuming adapters
  const args = process.argv.slice(2);
  const debugEnabled = isDebugEnabled() || args.includes('--debug');
  const logDir = path.join(globalConfigDir, 'logs');
  initDebug({ enabled: debugEnabled, logDir });
  if (debugEnabled) {
    process.stderr.write('\x1b[90m[ak-coder debug] logging to ~/.ak-coder/logs/{agent.log,ui.trace.log}\x1b[0m\n');
  }

  // Initialize Core Adapters
  const nfs = new NodeFileSystem();
  const isInteractive = process.stdin.isTTY && !args.includes('--stdio');

  // Interactive TTY uses Ink; stdio/pipe use NodeTerminalIo (readline-free)
  const nio = isInteractive
    ? new InkTerminalIo()
    : new NodeTerminalIo(true, () => REPL_COMMAND_NAMES);

  // Sandbox flag: --sandbox [--sandbox-image <image>] [--sandbox-readonly]
  const sandboxEnabled = args.includes('--sandbox');
  const sandboxImageIdx = args.indexOf('--sandbox-image');
  const sandboxImage = sandboxImageIdx !== -1 ? args[sandboxImageIdx + 1] : undefined;
  const sandboxReadOnly = args.includes('--sandbox-readonly');

  const npr = sandboxEnabled
    ? new DockerProcessRunner({
        workspaceRoot,
        image: sandboxImage,
        readOnly: sandboxReadOnly
      })
    : new NodeProcessRunner();

  if (sandboxEnabled && isInteractive) {
    process.stdout.write(`\x1b[35m[Sandbox Mode] Commands will run inside Docker (${sandboxImage ?? 'node:20-alpine'})${sandboxReadOnly ? ' [read-only workspace]' : ''}\x1b[0m\n`);
  }

  // Load config
  const configManager = new ConfigManager(nfs, path.join(globalConfigDir, 'config.json'));
  const globalConfig = await configManager.load();
  let config = { ...globalConfig };

  const localConfigPath = path.join(localConfigDir, 'config.json');
  if (await nfs.exists(localConfigPath)) {
    try {
      const localConfigManager = new ConfigManager(nfs, localConfigPath);
      const localConfig = await localConfigManager.load();
      config = {
        ...globalConfig,
        ...localConfig,
        mcpServers: {
          ...globalConfig.mcpServers,
          ...(localConfig.mcpServers || {})
        }
      };
      if (isInteractive) {
        process.stdout.write('\x1b[90mLoaded project-level configuration overrides from .ak-coder/config.json\x1b[0m\n');
      }
    } catch (e) {
      nio.writeError(`Failed to load project-level config overrides: ${(e as Error).message}\n`);
    }
  }

  // Initialize services using ports
  const llm = new OpenAICompatibleLLMService(config.apiKey, config.baseUrl, config.model);
  const historyDir = resolveWorkspaceHistoryDir(path.join(globalConfigDir, 'history'), workspaceRoot);
  const store = new FileSessionStore(nfs, historyDir);
  const logger = new FileLogger(nfs, logDir, 10 * 1024 * 1024, 5, debugEnabled ? 'debug' : 'info');

  // Register dependencies to Ports registry
  DependencyRegistry.register('fileSystem', nfs);
  DependencyRegistry.register('terminalIo', nio);
  DependencyRegistry.register('processRunner', npr);
  DependencyRegistry.register('llmService', llm);
  DependencyRegistry.register('sessionStore', store);
  DependencyRegistry.register('logger', logger);

  const core = new AgentCore(nfs, llm, store, logger, npr, nio, workspaceRoot);
  core.onPlanProduced = (text) => writePlanFile(workspaceRoot, text);
  core.setPricing(config.costInput, config.costOutput);
  core.setMaxContextTokens(config.contextTokens);
  await core.loadAgentsRules(workspaceRoot);
  await core.loadSkills(workspaceRoot);

  if (config.mcpServers && typeof config.mcpServers === 'object') {
    await core.loadMcpServers(config.mcpServers);
  }

  await core.loadPlugins(path.join(workspaceRoot, '.ak-coder', 'plugins'));

  // Register file-based hooks if they exist in the project directory
  const hooksDir = path.join(workspaceRoot, '.ak-coder', 'hooks');
  const registerCliHooks = async () => {
    const hooks: any = {};

    const beforeWritePath = path.join(hooksDir, 'before-write');
    if (await nfs.exists(beforeWritePath)) {
      hooks.beforeWriteFile = async (ctx: any) => {
        try {
          const res = await npr.run(`"${beforeWritePath}"`, {
            cwd: workspaceRoot,
            env: {
              ...process.env,
              AK_CODER_FILE_PATH: ctx.path,
              AK_CODER_FILE_CONTENT: ctx.content,
              AK_CODER_SESSION_ID: ctx.sessionId
            }
          });
          if (res.code !== 0) {
            return { cancel: true };
          }
          const trimmedStdout = res.stdout.trim();
          if (trimmedStdout) {
            return { content: trimmedStdout };
          }
        } catch (e) {
          nio.writeError(`Hook before-write failed to execute: ${(e as Error).message}\n`);
        }
      };
    }

    const afterWritePath = path.join(hooksDir, 'after-write');
    if (await nfs.exists(afterWritePath)) {
      hooks.afterWriteFile = async (ctx: any) => {
        try {
          await npr.run(`"${afterWritePath}"`, {
            cwd: workspaceRoot,
            env: {
              ...process.env,
              AK_CODER_FILE_PATH: ctx.path,
              AK_CODER_FILE_CONTENT: ctx.content,
              AK_CODER_SESSION_ID: ctx.sessionId,
              AK_CODER_WRITE_SUCCESS: String(ctx.success)
            }
          });
        } catch (e) {
          nio.writeError(`Hook after-write failed to execute: ${(e as Error).message}\n`);
        }
      };
    }

    const beforeCommandPath = path.join(hooksDir, 'before-command');
    if (await nfs.exists(beforeCommandPath)) {
      hooks.beforeExecuteCommand = async (ctx: any) => {
        try {
          const res = await npr.run(`"${beforeCommandPath}"`, {
            cwd: workspaceRoot,
            env: {
              ...process.env,
              AK_CODER_COMMAND: ctx.command,
              AK_CODER_SESSION_ID: ctx.sessionId
            }
          });
          if (res.code !== 0) {
            return { cancel: true };
          }
          const trimmedStdout = res.stdout.trim();
          if (trimmedStdout) {
            return { command: trimmedStdout };
          }
        } catch (e) {
          nio.writeError(`Hook before-command failed to execute: ${(e as Error).message}\n`);
        }
      };
    }

    const afterCommandPath = path.join(hooksDir, 'after-command');
    if (await nfs.exists(afterCommandPath)) {
      hooks.afterExecuteCommand = async (ctx: any) => {
        try {
          await npr.run(`"${afterCommandPath}"`, {
            cwd: workspaceRoot,
            env: {
              ...process.env,
              AK_CODER_COMMAND: ctx.command,
              AK_CODER_SESSION_ID: ctx.sessionId,
              AK_CODER_COMMAND_CODE: String(ctx.code),
              AK_CODER_COMMAND_STDOUT: ctx.stdout,
              AK_CODER_COMMAND_STDERR: ctx.stderr
            }
          });
        } catch (e) {
          nio.writeError(`Hook after-command failed to execute: ${(e as Error).message}\n`);
        }
      };
    }

    core.registerHooks(hooks);
  };

  await registerCliHooks();

  if (args.includes('--plan')) {
    core.setConfirmationMode('plan');
  }

  if (args.includes('init')) {
    process.stdout.write('\x1b[36mInitializing ak-coder workspace...\x1b[0m\n');
    await nfs.writeFile(path.join(workspaceRoot, 'AGENTS.md'), '# Workspace Instructions\n\n- Build Command: bun run build\n- Test Command: bun test\n');
    await nfs.writeFile(path.join(workspaceRoot, '.akcoderignore'), 'node_modules/\ndist/\n');
    process.stdout.write('\x1b[32mSuccessfully created AGENTS.md and .akcoderignore!\x1b[0m\n');
    process.exit(0);
  }

  if (args.includes('--stdio')) {
    const server = new StdioJsonRpcAdapter(core);
    server.start();
    return;
  }

  // Piping mode: read stdin and run one-off prompt
  if (!isInteractive) {
    let inputData = '';
    process.stdin.setEncoding('utf-8');
    for await (const chunk of process.stdin) {
      inputData += chunk;
    }
    const prompt = args[0] || 'Explain the input context';
    await core.startSession('pipe-' + Date.now());
    const result = await core.processMessage(`${prompt}\n\nContext:\n${inputData}`);
    process.stdout.write(result.text + '\n');
    process.exit(0);
  }

  // Interactive TTY — render Ink UI
  const modelName = config.model || 'unknown';
  const systemName = config.systemName;
  const assistantName = config.assistantName;
  const dirName = workspaceRoot.split('/').pop() ?? workspaceRoot;
  const nameDisplay = systemName.slice(0, 10).padEnd(10);
  process.stdout.write([
    '',
    `\x1b[36m ╭──────────────────────────────────────╮\x1b[0m`,
    `\x1b[36m │\x1b[0m  \x1b[1;36m ${nameDisplay}\x1b[0m  \x1b[90mv${cliPkg.version}\x1b[0m                    \x1b[36m│\x1b[0m`,
    `\x1b[36m │\x1b[0m  model  \x1b[33m${modelName.padEnd(30)}\x1b[0m\x1b[36m│\x1b[0m`,
    `\x1b[36m │\x1b[0m  cwd    \x1b[32m${dirName.slice(0, 30).padEnd(30)}\x1b[0m\x1b[36m│\x1b[0m`,
    `\x1b[36m ╰──────────────────────────────────────╯\x1b[0m`,
    `\x1b[90m  /help for commands · Shift+Tab cycles modes · Ctrl+R history\x1b[0m`,
    '',
  ].join('\n') + '\n');

  await core.startSession('session-' + Date.now());
  const inkNio = nio as InkTerminalIo;
  const { waitUntilExit } = await render(
    React.createElement(App, {
      core,
      nio: inkNio,
      workspaceRoot,
      store,
      llm,
      npr,
      model: config.model || 'unknown',
      assistantName,
      systemName,
    })
  );
  await waitUntilExit();
}

run();

