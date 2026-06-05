import {
  DependencyRegistry,
  AgentCore,
  ConfigManager,
  FileSessionStore,
  FileLogger,
  OpenAICompatibleLLMService
} from '@ak-coder/core';
import { NodeFileSystem } from './adapters/filesystem';
import { NodeTerminalIo } from './adapters/terminal';
import { NodeProcessRunner } from './adapters/process';
import { StdioJsonRpcAdapter } from './adapters/stdio';
import * as path from 'path';
import * as os from 'os';

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

  // Initialize Core Adapters
  const nfs = new NodeFileSystem();
  const nio = new NodeTerminalIo();
  const npr = new NodeProcessRunner();

  // Check command line flags
  const args = process.argv.slice(2);

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
      if (!args.includes('--stdio') && process.stdin.isTTY) {
        nio.write('\x1b[90mLoaded project-level configuration overrides from .ak-coder/config.json\x1b[0m\n');
      }
    } catch (e) {
      nio.writeError(`Failed to load project-level config overrides: ${(e as Error).message}\n`);
    }
  }

  // Initialize services using ports
  const llm = new OpenAICompatibleLLMService(config.apiKey, config.baseUrl, config.model);
  const store = new FileSessionStore(nfs, path.join(globalConfigDir, 'history'));
  const logger = new FileLogger(nfs, path.join(globalConfigDir, 'logs'));

  // Register dependencies to Ports registry
  DependencyRegistry.register('fileSystem', nfs);
  DependencyRegistry.register('terminalIo', nio);
  DependencyRegistry.register('processRunner', npr);
  DependencyRegistry.register('llmService', llm);
  DependencyRegistry.register('sessionStore', store);
  DependencyRegistry.register('logger', logger);

  const core = new AgentCore(nfs, llm, store, logger, npr, nio, workspaceRoot);
  core.setPricing(config.costInput, config.costOutput);
  await core.loadAgentsRules(workspaceRoot);
  await core.loadSkills(workspaceRoot);

  if (config.mcpServers && typeof config.mcpServers === 'object') {
    await core.loadMcpServers(config.mcpServers);
  }

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


  if (args.includes('init')) {
    // Run setup bootstrap
    nio.write('\x1b[36mInitializing ak-coder workspace...\x1b[0m');
    await nfs.writeFile(path.join(workspaceRoot, 'AGENTS.md'), '# Workspace Instructions\n\n- Build Command: bun run build\n- Test Command: bun test\n');
    await nfs.writeFile(path.join(workspaceRoot, '.akcoderignore'), 'node_modules/\ndist/\n');
    nio.write('\x1b[32mSuccessfully created AGENTS.md and .akcoderignore!\x1b[0m');
    nio.close();
    process.exit(0);
  }

  if (args.includes('--stdio')) {
    nio.close(); // Close terminal reader since stdin is JSON-RPC stream
    const server = new StdioJsonRpcAdapter(core);
    server.start();
    return;
  }

  // Piping mode check
  if (!process.stdin.isTTY) {
    nio.close();
    // Read all piped stdin content
    let inputData = '';
    process.stdin.setEncoding('utf-8');
    for await (const chunk of process.stdin) {
      inputData += chunk;
    }
    const prompt = args[0] || 'Explain the input context';
    // Run one-off prompt
    await core.startSession('pipe-' + Date.now());
    const result = await core.processMessage(`${prompt}\n\nContext:\n${inputData}`);
    process.stdout.write(result.text + '\n');
    process.exit(0);
  }

  // Default: Start Interactive REPL
  await core.startSession('session-' + Date.now());

  nio.write('\x1b[35mWelcome to ak-coder REPL!\x1b[0m Type /help for assistance, or /exit to quit.\n');

  while (true) {
    const prompt = await nio.ask('\x1b[32mak-coder > \x1b[0m');
    if (!prompt) continue;

    if (prompt.startsWith('/')) {
      const parts = prompt.split(' ');
      const command = parts[0];
      const cmdArgs = parts.slice(1).join(' ');

      if (command === '/exit') {
        nio.write('Goodbye!');
        await core.stopMcpServers();
        nio.close();
        process.exit(0);
      }

      if (command === '/help') {
        nio.write('Available slash commands:');
        nio.write('  /exit     - Exit the REPL session.');
        nio.write('  /context  - View loaded files and context info.');
        nio.write('  /help     - Show this help listing.');
        nio.write('  /ping     - Verify endpoint connection latency.');
        nio.write('  /budget   - View lifetime and recent budget spend details.');
        nio.write('  /stats    - View summary token metrics and latency stats.');
        nio.write('  /diff     - Show unified git diff of unstaged changes.');
        
        const skills = core.getSkills();
        if (skills.length > 0) {
          nio.write('\nAvailable Skills (run as /<skill-name> [arguments]):');
          for (const skill of skills) {
            nio.write(`  /${skill.name.padEnd(10)} - ${skill.description || 'No description provided.'}`);
          }
        }
        continue;
      }

      if (command === '/budget') {
        try {
          const records = await store.getCallRecords();
          const totalCost = records.reduce((sum, r) => sum + (r.cost || 0), 0);
          
          const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
          const recentCost = records
            .filter(r => new Date(r.timestamp).getTime() > oneDayAgo)
            .reduce((sum, r) => sum + (r.cost || 0), 0);

          nio.write('\x1b[36m--- Budget Summary ---\x1b[0m');
          nio.write(`  Total Spend:    $${totalCost.toFixed(5)}`);
          nio.write(`  Last 24h Spend: $${recentCost.toFixed(5)}`);
          nio.write(`  Total Calls:    ${records.length}`);
        } catch (e) {
          nio.writeError(`Failed to load budget metrics: ${(e as Error).message}`);
        }
        continue;
      }

      if (command === '/stats') {
        try {
          const records = await store.getCallRecords();
          const totalInput = records.reduce((sum, r) => sum + (r.inputTokens || 0), 0);
          const totalOutput = records.reduce((sum, r) => sum + (r.outputTokens || 0), 0);
          const avgLatency = records.length > 0
            ? records.reduce((sum, r) => sum + (r.latencyMs || 0), 0) / records.length
            : 0;

          nio.write('\x1b[36m--- Token & Call Stats ---\x1b[0m');
          nio.write(`  Total Input Tokens:  ${totalInput}`);
          nio.write(`  Total Output Tokens: ${totalOutput}`);
          nio.write(`  Total Tokens:        ${totalInput + totalOutput}`);
          nio.write(`  Avg Latency:         ${(avgLatency / 1000).toFixed(2)}s`);
        } catch (e) {
          nio.writeError(`Failed to load call statistics: ${(e as Error).message}`);
        }
        continue;
      }

      if (command === '/diff') {
        nio.write('Running git diff...');
        try {
          const result = await npr.run('git diff', { cwd: workspaceRoot });
          if (result.stdout.trim()) {
            nio.write(result.stdout);
          } else {
            nio.write('No unstaged changes detected.');
          }
        } catch (e) {
          nio.writeError(`Failed to run git diff: ${(e as Error).message}`);
        }
        continue;
      }

      if (command === '/context') {
        nio.write(`Active Files: ${core.getActiveFiles().join(', ') || 'None'}`);
        nio.write(`Compaction Summary: ${core.getContextSummary() || 'None'}`);
        continue;
      }

      if (command === '/ping') {
        nio.write('Pinging endpoint...');
        const start = Date.now();
        try {
          await llm.chat([{ role: 'user', content: 'ping' }]);
          nio.write(`Pong! Latency: ${Date.now() - start}ms`);
        } catch (e) {
          nio.writeError(`Ping failed: ${(e as Error).message}`);
        }
        continue;
      }

      // Check if it is a loaded skill command
      const skillName = command.slice(1);
      const skill = core.getSkills().find(s => s.name === skillName);
      if (skill) {
        nio.write(`\x1b[36mRunning skill: ${skill.name}...\x1b[0m\n`);
        const fullMessage = `Apply Skill "${skill.name}" with arguments: "${cmdArgs}"\n\nInstructions:\n${skill.content}`;
        nio.write('\x1b[36m[ak-coder is thinking...]\x1b[0m');
        try {
          const response = await core.processMessage(fullMessage, [], (chunk) => {
            process.stdout.write(chunk);
          });
          process.stdout.write('\n');
          nio.write(`\n\x1b[90mTokens: ${response.inputTokens} in / ${response.outputTokens} out | Est Cost: $${response.cost.toFixed(5)}\x1b[0m\n`);
        } catch (e) {
          nio.writeError(`Error executing skill: ${(e as Error).message}`);
        }
        continue;
      }

      nio.writeError(`Unknown command or skill: ${command}. Type /help for available commands.`);
      continue;
    }

    nio.write('\x1b[36m[ak-coder is thinking...]\x1b[0m');
    try {
      const response = await core.processMessage(prompt, [], (chunk) => {
        process.stdout.write(chunk);
      });
      process.stdout.write('\n');
      nio.write(`\n\x1b[90mTokens: ${response.inputTokens} in / ${response.outputTokens} out | Est Cost: $${response.cost.toFixed(5)}\x1b[0m\n`);
    } catch (e) {
      nio.writeError(`Error processing prompt: ${(e as Error).message}`);
    }
  }
}

run();
