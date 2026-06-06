/**
 * Interactive REPL for ak-coder.
 *
 * ## Adding a new slash command
 *
 * 1. Add an entry to the COMMANDS registry below.
 * 2. Implement the handler — it receives (args: string, ctx: CommandContext).
 * 3. The command automatically appears in /help and tab completion.
 * 4. No other files need editing.
 *
 * Example:
 *   '/mycommand': {
 *     description: 'Do something useful.',
 *     handler: async (args, { nio }) => { nio.write('Hello!'); }
 *   }
 */

import { AgentCore, LLMService, SessionStore, ProcessRunner, TerminalIo } from '@ak-coder/core';
import type { StreamChunk } from '@ak-coder/core';
import { runSubAgent } from '@ak-coder/core';
import { NodeTerminalIo } from './adapters/terminal';
import { writePlanFile, listPlans, readPlan } from './plan-file';
import { buildReplCompletionLines } from './slash-commands';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CommandContext {
  core: AgentCore;
  nio: TerminalIo & { close?(): void };
  workspaceRoot: string;
  store: SessionStore;
  llm: LLMService & { defaultModel?: string; baseUrl?: string };
  npr: ProcessRunner;
}

interface ReplCommand {
  description: string;
  handler(args: string, ctx: CommandContext): Promise<void>;
}

function createStreamChunkWriter() {
  let thinkingOpen = false;
  return (chunk: StreamChunk) => {
    if (chunk.type === 'thinking') {
      if (!thinkingOpen) {
        process.stdout.write('\n\x1b[35m╭─ Thinking ─────────────────────────────\x1b[0m\n');
        thinkingOpen = true;
      }
      process.stdout.write(`\x1b[90m\x1b[3m${chunk.text}\x1b[0m`);
      return;
    }
    if (thinkingOpen) {
      process.stdout.write('\n\x1b[35m╰──────────────────────────────────────\x1b[0m\n');
      thinkingOpen = false;
    }
    process.stdout.write(chunk.text);
  };
}

export interface ReplOptions {
  workspaceRoot: string;
  model: string;
  sandboxEnabled: boolean;
  sandboxImage?: string;
  sandboxReadOnly: boolean;
  planModeEnabled: boolean;
  store: SessionStore;
  llm: LLMService;
  npr: ProcessRunner;
}

// ── Command Registry ──────────────────────────────────────────────────────────
// Keys are the exact slash command strings typed by the user.
// /help and tab completion are generated automatically from this map.
// ─────────────────────────────────────────────────────────────────────────────

export const COMMANDS: Record<string, ReplCommand> = {

  '/new': {
    description: 'Start a new conversation (clears history).',
    handler: async (_args, { core, nio }) => {
      await core.startSession('session-' + Date.now());
      nio.write('\x1b[36mNew conversation started.\x1b[0m');
    }
  },

  '/exit': {
    description: 'Exit the REPL session.',
    handler: async (_args, { core, nio }) => {
      nio.write('Goodbye!');
      await core.stopMcpServers();
      nio.close?.();
      process.exit(0);
    }
  },

  '/help': {
    description: 'Show available commands and loaded skills.',
    handler: async (_args, { core, nio }) => {
      nio.write('Available slash commands:');
      for (const [cmd, def] of Object.entries(COMMANDS)) {
        nio.write(`  ${cmd.padEnd(18)} - ${def.description}`);
      }
      const skills = core.getSkills();
      if (skills.length > 0) {
        nio.write('\nAvailable Skills (invoke as /skills:<name> [args]):');
        for (const skill of skills) {
          nio.write(`  /skills:${skill.name.padEnd(14)} - ${skill.description || 'No description provided.'}`);
        }
      }
    }
  },

  '/context': {
    description: 'View full context: session, messages, skills, MCP servers, system prompt.',
    handler: async (_args, { core, nio }) => {
      const ctx = core.getContextInfo();

      nio.write('\x1b[36m── Session ───────────────────────────────\x1b[0m');
      nio.write(`  ID        ${ctx.sessionId ?? '(none)'}`);
      nio.write(`  Mode      ${ctx.mode ?? 'default'}`);
      nio.write(`  Messages  ${ctx.messageCount}`);
      nio.write(`  Context   ${ctx.contextPct}%  (~${ctx.estimatedTokens.toLocaleString()} / ${ctx.maxTokens.toLocaleString()} tokens)`);

      nio.write('\x1b[36m── System Prompt ─────────────────────────\x1b[0m');
      nio.write(`  AGENTS.md / CLAUDE.md  ${ctx.agentsRulesChars > 0 ? `${ctx.agentsRulesChars} chars` : '\x1b[90m(none)\x1b[0m'}`);
      nio.write(`  Compaction summary     ${ctx.summary ? `${ctx.summary.length} chars` : '\x1b[90m(none)\x1b[0m'}`);
      if (ctx.summary) {
        nio.write('\x1b[90m' + ctx.summary.slice(0, 300) + (ctx.summary.length > 300 ? '…' : '') + '\x1b[0m');
      }

      nio.write('\x1b[36m── Skills ────────────────────────────────\x1b[0m');
      if (ctx.skills.length === 0) {
        nio.write('  \x1b[90m(none loaded)\x1b[0m');
      } else {
        for (const s of ctx.skills) {
          nio.write(`  /skills:${s.name.padEnd(18)} ${s.description || ''}`);
        }
      }

      nio.write('\x1b[36m── MCP Servers ───────────────────────────\x1b[0m');
      if (ctx.mcpServers.length === 0) {
        nio.write('  \x1b[90m(none connected)\x1b[0m');
      } else {
        for (const s of ctx.mcpServers) {
          nio.write(`  \x1b[32m●\x1b[0m ${s}`);
        }
      }

      nio.write('\x1b[36m── Active Files ──────────────────────────\x1b[0m');
      if (ctx.activeFiles.length === 0) {
        nio.write('  \x1b[90m(none)\x1b[0m');
      } else {
        for (const f of ctx.activeFiles) {
          nio.write(`  ${f}`);
        }
      }
    }
  },

  '/ping': {
    description: 'Verify endpoint connection latency.',
    handler: async (_args, { llm, nio }) => {
      nio.write('Pinging endpoint...');
      const start = Date.now();
      try {
        await llm.chat([{ role: 'user', content: 'ping' }]);
        nio.write(`Pong! Latency: ${Date.now() - start}ms`);
      } catch (e) {
        nio.writeError(`Ping failed: ${(e as Error).message}`);
      }
    }
  },

  '/budget': {
    description: 'View lifetime and recent budget spend details.',
    handler: async (_args, { store, nio }) => {
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
    }
  },

  '/stats': {
    description: 'View summary token metrics and latency stats.',
    handler: async (_args, { store, nio }) => {
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
    }
  },

  '/diff': {
    description: 'Show unified git diff of unstaged changes.',
    handler: async (_args, { npr, workspaceRoot, nio }) => {
      nio.write('Running git diff...');
      try {
        const result = await npr.run('git diff', { cwd: workspaceRoot });
        nio.write(result.stdout.trim() || 'No unstaged changes detected.');
      } catch (e) {
        nio.writeError(`Failed to run git diff: ${(e as Error).message}`);
      }
    }
  },

  '/skills': {
    description: 'List skills or reload: /skills reload',
    handler: async (args, { core, nio }) => {
      const sub = args.trim().toLowerCase();
      if (sub === 'reload') {
        const count = await core.reloadSkills();
        nio.write(`\x1b[36mReloaded ${count} skill(s).\x1b[0m`);
        return;
      }
      const skills = core.getSkills();
      if (skills.length === 0) {
        nio.write('No skills loaded. Add SKILL.md files anywhere under the workspace.');
      } else {
        nio.write('Available Skills (invoke as /skills:<name> [args]):');
        for (const skill of skills) {
          nio.write(`  /skills:${skill.name.padEnd(14)} - ${skill.description || 'No description provided.'}`);
        }
      }
    }
  },

  '/history': {
    description: 'List saved sessions for the current workspace.',
    handler: async (_args, { core, nio }) => {
      try {
        nio.write(`\x1b[90mSessions for: ${core.getWorkspaceRoot()}\x1b[0m`);
        const sessions = await core.listSessions();
        if (sessions.length === 0) {
          nio.write('No saved sessions found.');
        } else {
          nio.write('\x1b[36m--- Saved Sessions ---\x1b[0m');
          for (const s of sessions.slice(0, 20)) {
            nio.write(`  ${s.sessionId}  \x1b[90m(${new Date(s.timestamp).toLocaleString()})\x1b[0m`);
          }
          if (sessions.length > 20) nio.write(`  … and ${sessions.length - 20} more`);
        }
      } catch (e) {
        nio.writeError(`Failed to list sessions: ${(e as Error).message}`);
      }
    }
  },

  '/resume': {
    description: 'Resume a previous session (shows picker if no ID given).',
    handler: async (args, { core, nio }) => {
      let sessionId = args.trim();

      if (!sessionId) {
        const sessions = await core.listSessions();
        if (sessions.length === 0) {
          nio.write('\x1b[90mNo saved sessions found.\x1b[0m');
          return;
        }
        const choices = sessions.slice(0, 20).map(s => ({
          name: `${s.sessionId}  \x1b[90m${new Date(s.timestamp).toLocaleString()}\x1b[0m`,
          value: s.sessionId,
        }));
        const picked = await nio.selectMenu('Resume session', choices);
        if (!picked) return;
        sessionId = picked as string;
      }

      try {
        await core.startSession(sessionId);
        nio.write(`\x1b[36mResumed: ${sessionId} — ${core.getMessages().length} messages loaded\x1b[0m`);
      } catch (e) {
        nio.writeError(`Failed to resume session: ${(e as Error).message}`);
      }
    }
  },

  '/rewind': {
    description: 'Rewind conversation to a previous turn (shows picker if no arg).',
    handler: async (args, { core, nio }) => {
      const turns = core.getUserTurns();
      if (turns.length === 0) {
        nio.write('\x1b[90mNo turns to rewind to.\x1b[0m');
        return;
      }

      let targetTurn: number;
      const raw = args.trim();

      if (raw) {
        // /rewind N — go back N turns from the end
        const n = parseInt(raw, 10);
        if (isNaN(n) || n < 1) { nio.writeError('Usage: /rewind [N]  (N turns back, default shows picker)'); return; }
        targetTurn = Math.max(0, turns.length - 1 - (n - 1));
      } else {
        const choices = turns.map(t => ({
          name: `Turn ${t.turnIndex + 1}: ${t.preview}`,
          value: t.turnIndex,
        }));
        const picked = await nio.selectMenu('Rewind to end of turn', choices);
        if (picked === undefined || picked === null) return;
        targetTurn = picked as number;
      }

      await core.rewindToTurn(targetTurn);
      nio.write(`\x1b[33m↩ Rewound to turn ${targetTurn + 1} — ${core.getMessages().length} messages kept\x1b[0m`);
    }
  },

  '/fork': {
    description: 'Fork current session at turn index (default: last).',
    handler: async (args, { core, nio }) => {
      const messages = core.getMessages();
      const turnIndex = args.trim() ? parseInt(args.trim(), 10) : messages.length - 1;
      if (isNaN(turnIndex)) { nio.writeError('Usage: /fork [turn_index]'); return; }
      try {
        const newId = await core.forkSession(turnIndex);
        await core.startSession(newId);
        nio.write(`\x1b[36mForked at turn ${turnIndex} → new session: ${newId}\x1b[0m`);
      } catch (e) {
        nio.writeError(`Failed to fork session: ${(e as Error).message}`);
      }
    }
  },

  '/plan': {
    description: 'Plan mode: /plan [on|off|list|show <file>|<text>].',
    handler: async (args, { core, nio, workspaceRoot }) => {
      const sub = args.trim();
      const subLower = sub.toLowerCase();

      if (subLower === 'off') {
        core.setConfirmationMode('default');
        nio.write('\x1b[90mPlan mode off — normal execution restored.\x1b[0m');

      } else if (subLower === '' || subLower === 'on') {
        core.setConfirmationMode('plan');
        nio.write('\x1b[38;5;226mPlan mode on — agent will gather context and produce a plan (no writes or commands).\x1b[0m');

      } else if (subLower === 'list') {
        const plans = await listPlans(workspaceRoot);
        if (plans.length === 0) {
          nio.write('\x1b[90mNo plan files found in .ak-coder/plans/\x1b[0m');
        } else {
          nio.write('\x1b[36mPlan files (newest first):\x1b[0m');
          plans.forEach((f, i) => nio.write(`  ${i + 1}. ${f}`));
        }

      } else if (subLower.startsWith('show ')) {
        const filename = sub.slice(5).trim();
        const content = await readPlan(workspaceRoot, filename);
        if (content === null) {
          nio.writeError(`Plan file not found: ${filename}`);
        } else {
          nio.write(`\x1b[36m── ${filename} ──\x1b[0m\n${content}`);
        }

      } else {
        // /plan <text> — persist plan file + follow-up menu
        const planPath = await writePlanFile(workspaceRoot, sub);
        nio.write(`\x1b[38;5;226m📝 Plan saved → ${planPath}\x1b[0m`);

        const choice = await nio.selectMenu('What next?', [
          { name: 'Suggest changes to this plan', value: 'suggest' },
          { name: 'Start fresh session with plan as context', value: 'fresh' },
          { name: 'Continue here with plan in context', value: 'continue' },
        ]);

        process.stdout.write('\x1b[36m  thinking…\x1b[0m');
        let msgText: string;
        if (choice === 'suggest') {
          msgText = `Review the following plan and suggest improvements, gaps, or risks:\n\n${sub}`;
        } else if (choice === 'fresh') {
          core.setConfirmationMode('default');
          await core.startSession(`session-${Date.now()}`);
          msgText = `Working from this plan:\n\n${sub}\n\nProceed with implementation.`;
        } else {
          core.setConfirmationMode('default');
          msgText = `Continuing with this plan in mind:\n\n${sub}`;
        }
        let firstChunk = true;
        const writeChunk = createStreamChunkWriter();
        const response = await core.processMessage(msgText, [], (chunk) => {
          if (firstChunk) { process.stdout.write('\r\x1b[2K'); firstChunk = false; }
          writeChunk(chunk);
        });
        process.stdout.write('\n');
        nio.write(`\x1b[90mTokens: ${response.inputTokens} in / ${response.outputTokens} out | Est Cost: $${response.cost.toFixed(5)}\x1b[0m\n`);
      }
    }
  },

  '/settings': {
    description: 'View or change settings: /settings [key] [value]',
    handler: async (args, { core, nio, workspaceRoot }) => {
      // Lazy-load config — read the global config file directly
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs/promises');

      const configPath = path.join(os.homedir(), '.ak-coder', 'config.json');

      const readConfig = async (): Promise<Record<string, unknown>> => {
        try {
          return JSON.parse(await fs.readFile(configPath, 'utf8'));
        } catch {
          return {};
        }
      };

      const writeConfig = async (cfg: Record<string, unknown>) => {
        await fs.mkdir(path.dirname(configPath), { recursive: true });
        await fs.writeFile(configPath, JSON.stringify(cfg, null, 2));
      };

      const parts = args.trim().split(/\s+/);
      const key = parts[0];
      const value = parts.slice(1).join(' ');

      const EDITABLE = ['assistantName', 'systemName', 'model', 'baseUrl', 'apiKey', 'costInput', 'costOutput', 'contextTokens'];

      if (!key) {
        // Show current settings
        const cfg = await readConfig();
        nio.write('\x1b[36m── Settings ──────────────────────────────\x1b[0m');
        for (const k of EDITABLE) {
          const v = cfg[k] ?? '\x1b[90m(default)\x1b[0m';
          nio.write(`  ${k.padEnd(16)} ${v}`);
        }
        nio.write('\x1b[90mUsage: /settings <key> <value>\x1b[0m');
        return;
      }

      if (!EDITABLE.includes(key)) {
        nio.writeError(`Unknown setting "${key}". Available: ${EDITABLE.join(', ')}`);
        return;
      }

      if (!value) {
        const cfg = await readConfig();
        nio.write(`${key} = ${cfg[key] ?? '(default)'}`);
        return;
      }

      const cfg = await readConfig();
      const coerced: unknown = (key === 'costInput' || key === 'costOutput' || key === 'contextTokens') ? parseFloat(value) : value;
      cfg[key] = coerced;
      await writeConfig(cfg);
      nio.write(`\x1b[36m✓ ${key} = ${coerced}\x1b[0m`);

      // Apply runtime changes where possible without restart
      if (key === 'model') {
        (core as any).llm && ((core as any).llm.defaultModel = value);
        nio.write('\x1b[90m(model applied immediately)\x1b[0m');
      }
      if (key === 'contextTokens') {
        core.setMaxContextTokens(Number(coerced));
        nio.write('\x1b[90m(context window applied immediately)\x1b[0m');
      }
      if (key === 'assistantName' || key === 'systemName') {
        nio.write('\x1b[90m(name change takes effect on next startup — run: node scripts/patch-signal-exit.mjs)\x1b[0m');
      }
    }
  },

  '/agent': {
    description: 'Spawn a sub-agent for a focused task: /agent <role> | <task>',
    handler: async (args, { core, nio }) => {
      const raw = args.trim();
      if (!raw) {
        nio.write('\x1b[90mUsage: /agent <role> | <task>\x1b[0m');
        nio.write('\x1b[90mExample: /agent Security Auditor | Review auth middleware for vulnerabilities\x1b[0m');
        return;
      }

      // Parse "role | task" — pipe separates role from task prompt
      const pipeIdx = raw.indexOf('|');
      let role: string;
      let taskPrompt: string;
      if (pipeIdx === -1) {
        role = 'General Assistant';
        taskPrompt = raw;
      } else {
        role = raw.slice(0, pipeIdx).trim() || 'General Assistant';
        taskPrompt = raw.slice(pipeIdx + 1).trim();
      }

      if (!taskPrompt) {
        nio.writeError('Task prompt is required. Usage: /agent <role> | <task>');
        return;
      }

      try {
        const child = core.spawnChildAgent();
        child.agentsRules = `You are a specialized sub-agent with the role: "${role}".\nYour task is:\n${taskPrompt}\n\nProvide a detailed and direct technical summary of your findings when done.`;

        const subSessionId = `sub-${Date.now()}`;
        await child.startSession(subSessionId);

        const result = await runSubAgent({
          terminalIo: nio,
          role,
          depth: child.delegationDepth,
          transcript: 'assistant',
          run: (stream) => child.processMessage(`Begin task: ${taskPrompt}`, [], stream)
        });

        nio.write(`\x1b[90mTokens: ${result.inputTokens} in / ${result.outputTokens} out\x1b[0m`);
      } catch (e) {
        nio.writeError(`Sub-agent failed: ${(e as Error).message}`);
      }
    }
  },

  '/model': {
    description: 'Switch LLM model. No args = list available Ollama models.',
    handler: async (args, { llm, core, nio }) => {
      const svc = llm as { defaultModel: string; baseUrl: string };
      const configuredBase = (svc.baseUrl ?? '').replace(/\/v1\/?$/, '');

      // Always probe Ollama at localhost:11434 first (may be available even if
      // the configured endpoint points elsewhere, e.g. Anthropic / OpenAI).
      const ollamaBase = 'http://localhost:11434';
      let models: string[] = [];
      let activeBase = ollamaBase;

      const tryOllama = async (base: string): Promise<string[]> => {
        try {
          const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2000) });
          if (res.ok) {
            const data = await res.json() as { models?: { name: string }[] };
            return (data.models ?? []).map((m: { name: string }) => m.name);
          }
        } catch {}
        return [];
      };

      const tryOpenAIModels = async (base: string): Promise<string[]> => {
        try {
          const res = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(2000) });
          if (res.ok) {
            const data = await res.json() as { data?: { id: string }[] };
            return (data.data ?? []).map((m: { id: string }) => m.id);
          }
        } catch {}
        return [];
      };

      // 1. Try local Ollama
      models = await tryOllama(ollamaBase);

      // 2. If configured endpoint differs from localhost, also probe it
      if (models.length === 0 && configuredBase && configuredBase !== ollamaBase) {
        activeBase = configuredBase;
        models = await tryOllama(configuredBase);
        if (models.length === 0) {
          models = await tryOpenAIModels(configuredBase);
        }
      }

      const target = args.trim();

      if (target) {
        svc.defaultModel = target;
        nio.write(`\x1b[36mModel → ${target}\x1b[0m`);
        return;
      }

      if (models.length === 0) {
        nio.write(`\x1b[33mCurrent model: ${svc.defaultModel}\x1b[0m`);
        nio.write('\x1b[90mOllama not detected. Use /model <name> to switch directly.\x1b[0m');
        return;
      }

      const source = activeBase === ollamaBase ? 'Ollama (localhost)' : activeBase;
      const choices = models.map(m => ({
        name: `${m === svc.defaultModel ? '✓ ' : '  '}${m}`,
        value: m,
      }));
      const selected = await nio.selectMenu(
        `Models from ${source} — current: ${svc.defaultModel}`,
        choices
      );
      if (selected && selected !== svc.defaultModel) {
        svc.defaultModel = selected as string;
        // If switching to a model from Ollama but currently using a different base URL, also update it
        if (activeBase === ollamaBase && svc.baseUrl && !svc.baseUrl.includes('localhost')) {
          svc.baseUrl = `${ollamaBase}/v1`;
          nio.write(`\x1b[90mSwitched provider to ${svc.baseUrl}\x1b[0m`);
        }
        nio.write(`\x1b[36mModel → ${svc.defaultModel}\x1b[0m`);
      }
    }
  },

  '/providers': {
    description: 'Manage LLM providers: /providers [select <name> | set <name> <key> <value>]',
    handler: async (args, { core, nio, llm }) => {
      const os = await import('os');
      const path = await import('path');
      const { NodeFileSystem } = await import('./adapters/filesystem');
      const { ConfigManager } = await import('@ak-coder/core');

      const configPath = path.join(os.homedir(), '.ak-coder', 'config.json');
      const configManager = new ConfigManager(new NodeFileSystem(), configPath);
      const config = await configManager.load();

      const providers = config.providers || {};
      const activeProvider = config.activeProvider;

      const parts = args.trim().split(/\s+/);
      const subCommand = parts[0]?.toLowerCase();

      if (!subCommand) {
        // List providers and their configs
        nio.write('\x1b[36m── Configured Providers ──────────────────\x1b[0m');
        if (Object.keys(providers).length === 0) {
          nio.write('  \x1b[90m(none)\x1b[0m');
        } else {
          for (const [name, prov] of Object.entries(providers)) {
            const isActive = name === activeProvider;
            const activeStr = isActive ? ' \x1b[32m(active)\x1b[0m' : '';
            const maskedKey = prov.apiKey
              ? (prov.apiKey === 'ollama' ? 'ollama' : `${prov.apiKey.slice(0, 3)}...${prov.apiKey.slice(-4)}`)
              : '(none)';
            nio.write(`  ${isActive ? '●' : ' '} \x1b[1m${name}\x1b[0m${activeStr}`);
            nio.write(`    model:    ${prov.model ?? '(none)'}`);
            nio.write(`    baseUrl:  ${prov.baseUrl ?? '(none)'}`);
            nio.write(`    apiKey:   ${maskedKey}`);
            if (prov.costInput !== undefined || prov.costOutput !== undefined) {
              nio.write(`    cost:     input $${prov.costInput ?? 0}/1M, output $${prov.costOutput ?? 0}/1M`);
            }
          }
        }
        nio.write('\n\x1b[90mUsage:\x1b[0m');
        nio.write('  /providers select <name>         - Switch active provider');
        nio.write('  /providers set <name> <k> <v>    - Update provider setting');
        return;
      }

      if (subCommand === 'select') {
        const name = parts[1];
        if (!name) {
          nio.writeError('Usage: /providers select <name>');
          return;
        }
        if (!providers[name]) {
          nio.writeError(`Unknown provider "${name}". Configured: ${Object.keys(providers).join(', ')}`);
          return;
        }

        config.activeProvider = name;
        await configManager.save(config);

        // Apply dynamically to core's llm service and pricing configuration
        const activeCfg = providers[name];
        if (activeCfg) {
          const svc = llm as any;
          if (activeCfg.model) svc.defaultModel = activeCfg.model;
          if (activeCfg.baseUrl) svc.baseUrl = activeCfg.baseUrl;
          if (activeCfg.apiKey) svc.apiKey = activeCfg.apiKey;
          
          if (activeCfg.costInput !== undefined && activeCfg.costOutput !== undefined) {
            core.setPricing(activeCfg.costInput, activeCfg.costOutput);
          }
        }

        nio.write(`\x1b[36m✓ Switched active provider to: ${name}\x1b[0m`);
        return;
      }

      if (subCommand === 'set') {
        const name = parts[1];
        const key = parts[2];
        const value = parts.slice(3).join(' ');

        if (!name || !key || !value) {
          nio.writeError('Usage: /providers set <name> <key> <value>');
          return;
        }

        const EDITABLE = ['apiKey', 'baseUrl', 'model', 'costInput', 'costOutput'];
        if (!EDITABLE.includes(key)) {
          nio.writeError(`Invalid setting "${key}". Available: ${EDITABLE.join(', ')}`);
          return;
        }

        if (!providers[name]) {
          providers[name] = {};
        }

        const coerced: any = (key === 'costInput' || key === 'costOutput') ? parseFloat(value) : value;
        (providers[name] as Record<string, unknown>)[key] = coerced;
        config.providers = providers;

        await configManager.save(config);
        nio.write(`\x1b[36m✓ Updated [${name}].${key} = ${coerced}\x1b[0m`);

        // If the updated provider is active, apply immediately
        if (name === activeProvider) {
          const svc = llm as any;
          if (key === 'model') svc.defaultModel = coerced;
          if (key === 'baseUrl') svc.baseUrl = coerced;
          if (key === 'apiKey') svc.apiKey = coerced;
          if (key === 'costInput' || key === 'costOutput') {
            const currentCostInput = key === 'costInput' ? coerced : (providers[name].costInput ?? 5.0);
            const currentCostOutput = key === 'costOutput' ? coerced : (providers[name].costOutput ?? 15.0);
            core.setPricing(currentCostInput, currentCostOutput);
          }
        }
        return;
      }

      nio.writeError(`Unknown command "${subCommand}". Use select or set.`);
    }
  }

};

// Exported so NodeTerminalIo can provide tab completion from the same source.
export const REPL_COMMAND_NAMES: string[] = [
  ...Object.keys(COMMANDS),
  '/plan on', '/plan off', '/plan list', '/plan show',
  '/agent',
  '/settings',
  '/providers',
  '/skills reload',
];

/** Tab-completion strings including dynamic skill names. */
export function getReplCommandNames(core: AgentCore): string[] {
  return buildReplCompletionLines({ core });
}

// ── Spinner ───────────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function startSpinner(label: string): () => void {
  let frame = 0;
  process.stdout.write(`\r\x1b[2K\x1b[33m${SPINNER_FRAMES[0]} ${label}\x1b[0m`);
  const timer = setInterval(() => {
    process.stdout.write(`\r\x1b[2K\x1b[33m${SPINNER_FRAMES[frame % SPINNER_FRAMES.length]} ${label}\x1b[0m`);
    frame++;
  }, 80);
  return () => { clearInterval(timer); process.stdout.write('\r\x1b[2K'); };
}

// ── Prompt builder ────────────────────────────────────────────────────────────

interface TurnStats { ms: number; outputTokens: number }

function buildPrompt(core: AgentCore, last?: TurnStats): string {
  const { contextPct, mode } = core.getStatus();

  const hints: string[] = [];
  if (mode !== 'default') hints.push(`\x1b[38;5;226m${mode}\x1b[90m`);
  hints.push(`${contextPct}% ctx`);
  if (last) {
    const secs = (last.ms / 1000).toFixed(0);
    const ktok = last.outputTokens >= 1000
      ? `${(last.outputTokens / 1000).toFixed(1)}k`
      : String(last.outputTokens);
    hints.push(`${secs}s  ↓${ktok}`);
  }

  const statusLine = `\x1b[90m  ${hints.join('  ·  ')}\x1b[0m\n`;
  return `${statusLine}\x1b[32m>\x1b[0m `;
}

// ── REPL entry point ──────────────────────────────────────────────────────────

export async function runRepl(core: AgentCore, nio: NodeTerminalIo, opts: ReplOptions): Promise<void> {
  const ctx: CommandContext = {
    core, nio,
    workspaceRoot: opts.workspaceRoot,
    store: opts.store,
    llm: opts.llm,
    npr: opts.npr,
  };

  // Wire compaction spinner
  let stopSpinner: (() => void) | null = null;
  core.onCompactingStart = () => { stopSpinner = startSpinner('Compacting context…'); };
  core.onCompactingEnd = () => { stopSpinner?.(); stopSpinner = null; };

  await core.startSession('session-' + Date.now());
  printBanner(nio, opts);

  let lastTurn: TurnStats | undefined;

  // Helper: run processMessage with timing + spinner management
  async function runMessage(userText: string): Promise<{ inputTokens: number; outputTokens: number; cost: number } | null> {
    const t0 = Date.now();
    let firstChunk = true;
    const writeChunk = createStreamChunkWriter();
    try {
      const response = await core.processMessage(userText, [], (chunk) => {
        if (firstChunk) {
          // Clear the "thinking…" line before first streamed content
          process.stdout.write('\r\x1b[2K');
          firstChunk = false;
        }
        writeChunk(chunk);
      });
      process.stdout.write('\n');
      lastTurn = { ms: Date.now() - t0, outputTokens: response.outputTokens };
      return response;
    } catch (e) {
      nio.writeError(`Error: ${(e as Error).message}`);
      return null;
    }
  }

  while (true) {
    const raw = await nio.ask(buildPrompt(core, lastTurn));
    if (!raw) continue;

    if (raw.startsWith('/')) {
      const spaceIdx = raw.indexOf(' ');
      const command = spaceIdx === -1 ? raw : raw.slice(0, spaceIdx);
      const cmdArgs = spaceIdx === -1 ? '' : raw.slice(spaceIdx + 1);

      const def = COMMANDS[command];
      if (def) {
        await def.handler(cmdArgs, ctx);
        continue;
      }

      // Loaded skill fallback: /skill-name [arguments]
      const skillName = command.slice(1);
      const skill = core.getSkills().find(s => s.name === skillName);
      if (skill) {
        nio.write(`\x1b[36mRunning skill: ${skill.name}…\x1b[0m`);
        process.stdout.write('\x1b[36m  thinking…\x1b[0m');
        const response = await runMessage(
          `Apply Skill "${skill.name}" with arguments: "${cmdArgs}"\n\nInstructions:\n${skill.content}`
        );
        if (response) {
          nio.write(`\x1b[90mTokens: ${response.inputTokens} in / ${response.outputTokens} out | Est Cost: $${response.cost.toFixed(5)}\x1b[0m\n`);
        }
        continue;
      }

      nio.writeError(`Unknown command or skill: ${command}. Type /help for available commands.`);
      continue;
    }

    // Regular prompt → send to agent
    process.stdout.write('\x1b[36m  thinking…\x1b[0m');
    const response = await runMessage(raw);
    if (response) {
      nio.write(`\x1b[90mTokens: ${response.inputTokens} in / ${response.outputTokens} out | Est Cost: $${response.cost.toFixed(5)}\x1b[0m\n`);
    }
  }
}

// ── Banner ────────────────────────────────────────────────────────────────────

function printBanner(nio: NodeTerminalIo, opts: ReplOptions): void {
  const pkgVersion = '0.1.0';
  const truncatedRoot = opts.workspaceRoot.length > 52
    ? '…' + opts.workspaceRoot.slice(-51)
    : opts.workspaceRoot;
  const sandboxLine = opts.sandboxEnabled
    ? `\x1b[38;5;141m  ⧡ Sandbox   \x1b[0m\x1b[90mDocker (${opts.sandboxImage ?? 'node:20-alpine'})${opts.sandboxReadOnly ? ' [read-only]' : ''}\x1b[0m\n`
    : '';
  const planLine = opts.planModeEnabled
    ? `\x1b[38;5;226m   ✎ Plan Mode  \x1b[0m\x1b[90mRead-only — agent produces a plan, no writes or commands\x1b[0m\n`
    : '';

  nio.write(
    '\n' +
    '\x1b[38;5;99m   ██████╗ ██╗  ██╗      ██████╗ ██████╗ ██████╗ ███████╗██████╗ \x1b[0m\n' +
    '\x1b[38;5;99m   ██╔══██╗██║ ██╔╝     ██╔════╝██╔═══██╗██╔══██╗██╔════╝██╔══██╗\x1b[0m\n' +
    '\x1b[38;5;135m   ███████║█████╔╝      ██║     ██║   ██║██║  ██║█████╗  ██████╔╝\x1b[0m\n' +
    '\x1b[38;5;135m   ██╔══██║██╔═██╗      ██║     ██║   ██║██║  ██║██╔══╝  ██╔══██╗\x1b[0m\n' +
    '\x1b[38;5;141m   ██║  ██║██║  ██╗     ╚██████╗╚██████╔╝██████╔╝███████╗██║  ██║\x1b[0m\n' +
    '\x1b[38;5;141m   ╚═╝  ╚═╝╚═╝  ╚═╝      ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝\x1b[0m\n' +
    '\n' +
    `\x1b[90m   v${pkgVersion}  ·  agentic terminal coding assistant\x1b[0m\n` +
    '\n' +
    `\x1b[38;5;99m   ◆ Model     \x1b[0m\x1b[97m${opts.model}\x1b[0m\n` +
    `\x1b[38;5;99m   ◆ Workspace \x1b[0m\x1b[97m${truncatedRoot}\x1b[0m\n` +
    sandboxLine +
    planLine +
    '\n' +
    '\x1b[90m   Type \x1b[97m/help\x1b[90m for commands  ·  \x1b[97m/exit\x1b[90m to quit  ·  Ctrl+C to interrupt\x1b[0m\n' +
    '\x1b[90m   ───────────────────────────────────────────────────────────────\x1b[0m\n' +
    '\n'
  );
}
