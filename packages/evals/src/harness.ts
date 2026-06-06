import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  AgentCore,
  MockFileSystem,
  MockSessionStore,
  MockLogger,
  MockTerminalIo,
} from '@ak-coder/core';
import type { LLMService, ProcessRunner, ConfirmationResult } from '@ak-coder/core';
import type { StaticCriterion, CheckContext } from './checks';
import type { JudgeCriterion } from './judge';

export type Criterion = StaticCriterion | JudgeCriterion;

export interface EvalCase {
  name: string;
  timeout?: number;
  setup?: (env: EvalEnv) => void | Promise<void>;
  prompts?: string | string[];
  /** Custom multi-step run; when set, replaces the prompts loop. */
  run?: (ctx: EvalRunContext) => Promise<void>;
  criteria: Criterion[];
}

export interface CriterionResult {
  description: string;
  type: 'static' | 'judge';
  pass: boolean;
  reasoning?: string;
}

export interface EvalResult {
  name: string;
  pass: boolean;
  criteria: CriterionResult[];
  totalTokens: number;
  latencyMs: number;
  error?: string;
}

export class EvalEnv {
  public readonly fs = new MockFileSystem();
  public readonly store = new MockSessionStore();
  public readonly logger = new MockLogger();
  public readonly nio = new MockTerminalIo();

  private _processRunner?: ProcessRunner;
  private _realWorkspaceDir?: string;  // actual temp dir on disk for bash evals
  private _mcpServers: { name: string; command: string; args: string[] }[] = [];
  private _pluginManifests: { name: string; command: string; args: string[] }[] = [];
  private _skills: { path: string; content: string }[] = [];
  private _confirmationPreset?: 'default' | 'yolo' | 'confirm-writes' | 'confirm-commands' | 'plan';

  files(map: Record<string, string>): this {
    for (const [path, content] of Object.entries(map)) {
      this.fs.files.set(path, content);
    }
    return this;
  }

  withConfirmationPreset(preset: 'default' | 'yolo' | 'confirm-writes' | 'confirm-commands' | 'plan'): this {
    this._confirmationPreset = preset;
    return this;
  }

  confirmAll(): this {
    // Pre-load a large queue of approvals so any confirmation is auto-approved
    this.nio.confirmResults = Array.from({ length: 50 }, () => ({
      approved: true,
      applyToAll: true,
    } satisfies ConfirmationResult));
    return this;
  }

  withProcessRunner(runner?: ProcessRunner): this {
    if (runner) {
      this._processRunner = runner;
    } else {
      // Lazy import to avoid pulling Node adapters into core
      const { NodeProcessRunner } = require('../../../apps/cli/src/adapters/process');
      this._processRunner = new NodeProcessRunner();
      // Create a real temp directory so bash commands have a valid cwd
      this._realWorkspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-eval-'));
    }
    return this;
  }

  /** Write real files to the temp workspace directory (for bash commands to see). */
  realFiles(map: Record<string, string>): this {
    if (!this._realWorkspaceDir) {
      const { NodeProcessRunner } = require('../../../apps/cli/src/adapters/process');
      this._processRunner = this._processRunner ?? new NodeProcessRunner();
      this._realWorkspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-eval-'));
    }
    for (const [relPath, content] of Object.entries(map)) {
      const full = path.join(this._realWorkspaceDir, relPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    return this;
  }

  cleanup(): void {
    if (this._realWorkspaceDir) {
      fs.rmSync(this._realWorkspaceDir, { recursive: true, force: true });
      this._realWorkspaceDir = undefined;
    }
  }

  withMcp(name: string, command: string, args: string[]): this {
    this._mcpServers.push({ name, command, args });
    return this;
  }

  withPlugin(manifest: { name: string; command: string; args?: string[] }): this {
    this._pluginManifests.push({ name: manifest.name, command: manifest.command, args: manifest.args ?? [] });
    return this;
  }

  withSkill(path: string, content: string): this {
    this._skills.push({ path, content });
    return this;
  }

  async buildAgent(llm: LLMService, workspaceRoot = '/ws'): Promise<AgentCore> {
    // When a real process runner is used, the cwd must exist on disk
    const effectiveRoot = this._realWorkspaceDir ?? workspaceRoot;

    const agent = new AgentCore(
      this.fs,
      llm,
      this.store,
      this.logger,
      this._processRunner,
      this.nio,
      effectiveRoot
    );

    if (this._confirmationPreset) {
      agent.setConfirmationMode(this._confirmationPreset);
    }

    if (this._mcpServers.length > 0) {
      const config: Record<string, { command: string; args: string[] }> = {};
      for (const s of this._mcpServers) config[s.name] = { command: s.command, args: s.args };
      await agent.loadMcpServers(config);
    }

    for (const p of this._pluginManifests) {
      const pluginDir = `/.evals-plugins/${p.name}`;
      this.fs.files.set(`${pluginDir}/plugin.json`, JSON.stringify(p));
      await agent.loadPlugins('/.evals-plugins');
    }

    for (const s of this._skills) {
      this.fs.files.set(s.path, s.content);
    }
    if (this._skills.length > 0) {
      await agent.loadSkills(effectiveRoot);
    }

    return agent;
  }
}

export function skillInvokePrompt(skill: { name: string; content: string }, args = ''): string {
  return args.trim()
    ? `Apply Skill "${skill.name}" with arguments: "${args}"\n\nInstructions:\n${skill.content}`
    : `Apply Skill "${skill.name}".\n\nInstructions:\n${skill.content}`;
}

export interface EvalRunContext {
  env: EvalEnv;
  agent: AgentCore;
  prompt(text: string): Promise<string>;
  invokeSkill(name: string, args?: string): Promise<string>;
}

const registry: EvalCase[] = [];

export function evalCase(name: string, def: Omit<EvalCase, 'name'>): void {
  registry.push({ name, ...def });
}

export function getRegistry(): readonly EvalCase[] {
  return registry;
}
