/**
 * Slash-command completion registry for the REPL.
 *
 * Static commands come from repl.ts COMMANDS. Extensions add dynamic entries
 * (e.g. /skills:my-skill) without editing the base command map.
 *
 * Register an extension:
 *   registerSlashCommandExtension({ prefix: 'mcp', getCommands: (ctx) => [...] });
 */

import type { AgentCore } from '@ak-coder/core';
import { COMMANDS } from './repl';

export interface SlashCommand {
  name: string;
  description: string;
}

export interface SlashCommandContext {
  core: AgentCore;
}

export interface SlashCommandExtension {
  /** Namespace prefix without leading slash (e.g. "skills" → /skills:foo). */
  prefix: string;
  getCommands(ctx: SlashCommandContext): SlashCommand[];
}

const extensions: SlashCommandExtension[] = [];

export function registerSlashCommandExtension(ext: SlashCommandExtension): void {
  extensions.push(ext);
}

/** Static slash commands derived from the COMMANDS registry. */
export function buildBaseSlashCommands(): SlashCommand[] {
  const fromRegistry = Object.entries(COMMANDS).map(([cmd, def]) => ({
    name: cmd.slice(1),
    description: def.description,
  }));

  const extras: SlashCommand[] = [
    { name: 'plan on', description: 'Enable plan mode (read-only).' },
    { name: 'plan off', description: 'Disable plan mode.' },
    { name: 'plan list', description: 'List saved plan files.' },
    { name: 'plan show', description: 'Show a plan file: /plan show <filename>' },
    { name: 'agent', description: 'Spawn a sub-agent: /agent <role> | <task>' },
    { name: 'settings', description: 'View or change settings.' },
    { name: 'providers', description: 'Manage LLM providers.' },
  ];

  const seen = new Set(fromRegistry.map(c => c.name));
  return [...fromRegistry, ...extras.filter(c => !seen.has(c.name))];
}

registerSlashCommandExtension({
  prefix: 'skills',
  getCommands({ core }) {
    const cmds: SlashCommand[] = [
      { name: 'skills reload', description: 'Rescan workspace for SKILL.md files.' },
    ];
    for (const skill of core.getSkills()) {
      cmds.push({
        name: `skills:${skill.name}`,
        description: skill.description || 'Invoke skill',
      });
    }
    return cmds;
  },
});

/** Full command list for PromptInput autocomplete (static + dynamic extensions). */
export function buildSlashCommands(ctx: SlashCommandContext): SlashCommand[] {
  const base = buildBaseSlashCommands();
  const seen = new Set(base.map(c => c.name));
  const dynamic: SlashCommand[] = [];

  for (const ext of extensions) {
    for (const cmd of ext.getCommands(ctx)) {
      if (!seen.has(cmd.name)) {
        seen.add(cmd.name);
        dynamic.push(cmd);
      }
    }
  }

  return [...base, ...dynamic];
}

/** Tab-completion strings for readline (legacy NodeTerminalIo). */
export function buildReplCompletionLines(ctx: SlashCommandContext): string[] {
  return buildSlashCommands(ctx).map(c => `/${c.name}`);
}

/** Filter completions for a partial input line (readline completer helper). */
export function filterReplCompletions(line: string, completions: string[]): [string[], string] {
  if (!line.startsWith('/')) return [[], line];
  const hits = completions.filter(c => c.startsWith(line));
  return [hits.length ? hits : completions.filter(c => c.startsWith('/')), line];
}
