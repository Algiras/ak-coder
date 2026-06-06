# packages/core/src — Source conventions

## File Map

| File | Purpose |
|------|---------|
| `agent.ts` | `AgentCore` class — session lifecycle, `processMessage` ReAct loop, tool dispatch, compaction |
| `core-tools.ts` | All built-in tool definitions (delegated to `features/tools/`) + `ToolContext` interface + `registerCoreTools()` factory |
| `ports.ts` | All port interfaces (`FileSystem`, `LLMService`, `SessionStore`, `TerminalIo`, `ProcessRunner`, `Logger`, `ToolAnnotations`) |
| `features/confirmation/confirmation.ts` | `ConfirmationPolicy` — 5 presets, gates writes/commands, delegates to `TerminalIo.confirm` |
| `features/safety/safety.ts` | `CommandSafetyGate` — classifies commands safe/unsafe, persists per-session authorizations |
| `features/diff/diff.ts` | Myers-diff engine for colored unified diffs shown before writes |
| `features/hooks/hooks.ts` | `AgentHooks` interface (`beforeWriteFile`, `afterWriteFile`, `beforeExecuteCommand`, `afterExecuteCommand`, `beforeChat`, `afterChat`) |
| `features/mcp/mcp.ts` | `McpClient` — spawns local MCP server processes, JSON-RPC over stdio |
| `features/ignore/ignore.ts` | `.akcoderignore` / `.gitignore` pattern matching |
| `features/history/vector-store.ts` | In-memory TF-IDF vector store for semantic search |
| `features/history/indexer.ts` | `WorkspaceIndexer` — chunks files, produces embedding vectors |
| `features/rules/rules.ts` | `RulesManager` — loads `AGENTS.md` rules |
| `features/skills/skills.ts` | `SkillsManager` — loads `SKILL.md` custom slash commands |
| `features/tools/` | Built-in tool handlers (e.g. `read_file.ts`, `write_file.ts`, `bash.ts`, etc.) |
| `config.ts` | `ConfigManager` — loads/saves `~/.ak-coder/config.json` |
| `features/history/history.ts` | `FileSessionStore` — serializes chat history to disk |
| `logger.ts` | `FileLogger` — writes structured JSON logs with span tracing |
| `registry.ts` | `DependencyRegistry` — service locator for adapters |
| `mocks/` | `MockFileSystem`, `MockSessionStore`, `MockLogger`, `MockTerminalIo` for tests |


---

## How to Add a New Core Tool

Edit **`core-tools.ts`** — add a `tools.set(...)` block inside `registerCoreTools()`:

```ts
tools.set('my_tool', {
  name: 'my_tool',
  description: 'What the tool does (shown to the LLM).',
  annotations: {
    title: 'My Tool',
    readOnlyHint: true,   // set true ONLY if no side effects — enables parallel execution
  },
  schema: z.object({
    input: z.string().describe('Description of the parameter'),
  }),
  handler: async (args) => {
    // ctx is available via closure — use ctx.fs, ctx.processRunner, etc.
    return `Result: ${args.input}`;
  }
});
```

Then add a test in `packages/core/tests/`.

**Key rules:**
- `readOnlyHint: true` → tool may run in parallel with other read-only tools in the same LLM turn.
- `destructiveHint: true` → always show confirmation dialog regardless of policy preset.
- Use `ctx.resolveWorkspacePath(path)` to turn relative paths into absolute ones.
- Expose mutable state via `ctx` callbacks, not direct field access.

---

## How to Add a New Port

A port is an interface in `ports.ts` that decouples core from a platform concern.

1. Add the interface to `ports.ts`.
2. Add a constructor parameter to `AgentCore` (optional, so tests don't break).
3. Expose it on the `ToolContext` in `core-tools.ts` if tools need it.
4. Implement a concrete adapter in `apps/cli/src/adapters/`.
5. Write a mock in `packages/core/src/mocks/` for unit tests.

---

## How to Add a New Hook

Hooks let external code intercept agent events without modifying core.

1. Add the hook signature to `AgentHooks` in `hooks.ts`.
2. Call it at the appropriate point in `agent.ts` or the relevant tool handler in `core-tools.ts`.
3. Register hook implementations via `AgentCore.registerHooks(hooks)`.

Hooks available today: `beforeWriteFile`, `afterWriteFile`, `beforeExecuteCommand`, `afterExecuteCommand`, `beforeChat`, `afterChat`.

---

## How to Add a New Confirmation Preset

1. Add the preset name to `ConfirmationPreset` type in `confirmation.ts`.
2. Define its policy object (which actions to auto-approve, auto-deny, or prompt).
3. Add to the `PRESETS` map in `ConfirmationPolicy`.

---

## Confirmation Flow

```
tool handler → confirmationPolicy.check(action, request, terminalIo, safetyGate?)
            → if preset='yolo'      → auto-approve
            → if preset='plan'      → auto-deny (returns rejected)
            → if safetyGate says safe → auto-approve
            → else                  → terminalIo.confirm(request) → user choice
```
