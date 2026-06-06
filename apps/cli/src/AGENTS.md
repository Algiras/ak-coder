# apps/cli/src — CLI conventions

## File Map

| File | Purpose |
|------|---------|
| `index.ts` | Startup wiring — parses args, loads config, wires adapters, delegates to `runRepl` or one-shot modes |
| `repl.ts` | Interactive REPL — `COMMANDS` registry, session init, startup banner, REPL loop |
| `plan-file.ts` | Plan file utilities — `writePlanFile`, `listPlans`, `readPlan`, random filename generation |
| `adapters/` | Concrete implementations of core port interfaces |

## How to Add a New REPL Command

Edit **`repl.ts`** — add one entry to the `COMMANDS` object near the top of the file:

```ts
'/mycommand': {
  description: 'What this command does (shown in /help).',
  handler: async (args, { core, nio, workspaceRoot, store, llm, npr }) => {
    // args = everything typed after /mycommand
    nio.write('Hello from mycommand!');
  }
},
```

That's it. The command will:
- Appear in `/help` automatically (description included)
- Appear in tab completion automatically (via `REPL_COMMAND_NAMES`)
- Be dispatched from the REPL loop automatically

No other files need editing.

## How to Add a Sub-Command to `/plan`

The `/plan` command handles its sub-commands internally inside its `handler`. Add a new `else if` branch:

```ts
} else if (subLower === 'mysubcmd') {
  // handle /plan mysubcmd
}
```

Then add `'/plan mysubcmd'` to the `REPL_COMMAND_NAMES` export at the bottom of `repl.ts`.

## Startup Flow (`index.ts`)

1. Parse CLI args (`--plan`, `--sandbox`, `--stdio`, `init`)
2. Create adapters: `NodeFileSystem`, `NodeTerminalIo` (with `REPL_COMMAND_NAMES` for tab completion), `NodeProcessRunner` / `DockerProcessRunner`
3. Load global + project-level config (merged, project overrides global)
4. Construct `AgentCore` and wire optional hooks from `.ak-coder/hooks/`
5. Load MCP servers, plugins, AGENTS.md rules, skills
6. Dispatch: `--stdio` → `StdioJsonRpcAdapter`; piped stdin → one-shot; TTY → `runRepl`

## Plan Files (`plan-file.ts`)

- Stored in `<workspaceRoot>/.ak-coder/plans/plan-<timestamp>-<hex4>.md`
- `writePlanFile(root, content)` → creates dir on demand, returns absolute path
- `listPlans(root)` → sorted newest-first (lexicographic on filename timestamp)
- `readPlan(root, filename)` → returns content or `null` if missing
