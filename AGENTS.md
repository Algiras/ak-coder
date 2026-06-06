# ak-coder — Workspace Instructions (Diff Test Final)

## Overview

ak-coder is a **hexagonal-architecture** TypeScript monorepo. The core agent logic is fully decoupled from I/O adapters through port interfaces, making every component independently testable.

## Repository Layout

```
packages/
  core/        — AgentCore, ports, tool registry, MCP client, vector store
  sdk/         — PluginSDK for plugin development
  evals/       — LLM-as-judge eval harness (Ollama-backed)
apps/
  cli/         — Node.js terminal REPL + startup wiring
docs/
  adrs/        — Architecture Decision Records
```

## Build & Test

Bun uses the same `package.json` as npm/yarn — same `scripts`, `dependencies`, `workspaces` format. The only Bun-specific files are `bun.lockb` (binary lockfile) and `bunfig.toml`.

```bash
bun test                        # run all tests
bun test packages/core          # run core tests only
bun test apps/cli               # run CLI tests only
bun test <path/to/test.ts>      # run a specific test file
bun run packages/evals/run.ts   # run LLM evals (requires Ollama)
```

No separate build/compile step — Bun executes TypeScript directly.

---

## AGENTS.md / SKILL.md Format

### AGENTS.md (workspace instructions)

The agent reads `AGENTS.md` (or `CLAUDE.md` as fallback) from the workspace root at startup. The **entire file content** is injected verbatim into the system prompt as:

```
[Project-Specific Rules & Build Instructions:
<file content>
]
```

**What to put in it:** build commands, test commands, repo conventions, file layout, anything the agent should know before touching code. Plain Markdown — no special format required.

Only the **workspace root** `AGENTS.md` is read. Sub-directory `AGENTS.md` files (like this one) are documentation for humans and tools like Claude Code — the agent does not read them automatically.

### SKILL.md (custom slash commands)

Any file named `SKILL.md` anywhere in the workspace is loaded as a skill. The skill becomes available as `/<name>` in the REPL.

Required front-matter:

```markdown
---
name: my-skill
description: One-line description shown in /help
---

Full skill instructions go here. The agent receives these instructions
along with any arguments the user typed after /my-skill.
```

The `name` field drives the slash command. `description` appears in `/help`. The rest of the file is the instruction content sent to the LLM.

---

## Extension Workflows

### Add a new REPL slash command

**File:** `apps/cli/src/repl.ts` — `COMMANDS` object

```ts
'/mycommand': {
  description: 'One-line description shown in /help.',
  handler: async (args, { core, nio, workspaceRoot, store, llm, npr }) => {
    nio.write('Hello!');
  }
}
```

Auto-appears in `/help` and tab completion. No other files to edit.

### Add a new built-in agent tool

**Folder:** `packages/core/src/features/tools/`

Create a new file under the `tools/` folder (e.g. `my_tool.ts`) and define a strict schema type composition:

```ts
import { z } from 'zod';
import { CoreToolDefinition, ToolContext } from './types';

const schema = z.object({
  input: z.string().describe('Description...')
});

export const myTool = (ctx: ToolContext): CoreToolDefinition<typeof schema> => ({
  name: 'my_tool',
  description: 'Description shown to the LLM.',
  annotations: { title: 'My Tool', readOnlyHint: true },
  schema,
  handler: async (args) => {
    // args is strictly typed as { input: string }
    return 'result';
  }
});
```

Then, register it in `packages/core/src/core-tools.ts` under `registerCoreTools`. See `packages/core/src/AGENTS.md` for `ToolAnnotations` rules and `ToolContext` API.

### Add a plugin (external MCP tool server)

Create `.ak-coder/plugins/<name>/plugin.json` + a script. See `packages/sdk/src/AGENTS.md`.

### Add a new SDK capability (resources, prompts)

Edit `packages/sdk/src/index.ts` — add registry + handler. See `packages/sdk/src/AGENTS.md`.

### Add a new eval check type

**File:** `packages/evals/src/checks.ts` — export a new `StaticCriterion` function and add it to the `check` object. See `packages/evals/AGENTS.md`.

### Add a new port (platform abstraction)

1. Define interface in `packages/core/src/ports.ts`
2. Implement adapter in `apps/cli/src/adapters/<name>.ts`
3. Add mock in `packages/core/src/mocks/`
4. Wire in `apps/cli/src/index.ts`

### Add a lifecycle hook

`packages/core/src/hooks.ts` → add signature → call in `agent.ts` / tool handler → register via `core.registerHooks({...})`.

### Add a confirmation preset

`packages/core/src/confirmation.ts` — add name to `ConfirmationPreset` type and a policy entry to `PRESETS`.

---

## Key Conventions

- **Ports** (`packages/core/src/ports.ts`) are the only cross-boundary interfaces. Never import concrete adapters from core.
- **`readOnlyHint: true`** tools run in parallel via `Promise.allSettled` when the LLM calls multiple in one turn.
- **`ToolContext`** (in `core-tools.ts`) is the only way tool handlers access agent state. Never reach back into `AgentCore` directly.
- Every new tool needs at minimum a happy-path and error-path unit test using mocks from `packages/core/src/mocks/`.

<!-- This line was added to test writing capabilities -->

## Testing & Rendering
This section is used to verify file editing and Markdown rendering.

### Rendering Checklist
- [x] **Bold text** and *Italics*
- [x] Code blocks with syntax highlighting
- [x] Task lists
- [x] Tables

| Feature | Status | Note |
| :--- | :---: | :--- |
| Patching | ✅ | Working |
| Reading | ✅ | Working |
| Diffs | ✅ | Verified |

```typescript
const test = "This is a code block inside the file";
console.log(test);
```

