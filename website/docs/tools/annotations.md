---
sidebar_position: 2
---

# Tool Annotations

Every built-in tool declares optional **annotations** — metadata that tells ak-coder and the LLM how to treat the tool at runtime. Annotations are defined on `ToolAnnotations` in `packages/core/src/ports.ts` and set in each tool file under `packages/core/src/features/tools/`.

## Annotation fields

| Field | Type | Meaning |
|-------|------|---------|
| `title` | string | Human-readable label shown in the REPL spinner (e.g. `Read File`) |
| `readOnlyHint` | boolean | Tool has no side effects — enables **parallel execution** when the LLM calls multiple read-only tools in one turn |
| `destructiveHint` | boolean | Tool may mutate state — documented for LLM providers that consume MCP-style hints; write/bash tools always go through confirmation policy regardless |
| `idempotentHint` | boolean | Repeated calls with the same arguments produce the same result — informational hint for the LLM |
| `openWorldHint` | boolean | Tool reaches outside the workspace (network, sub-agents, shell) — informational hint for the LLM |

## How ak-coder uses annotations

### Parallel execution (`readOnlyHint`)

When the LLM returns **multiple tool calls in one turn**, ak-coder checks whether every call is read-only:

```text
all tools have readOnlyHint: true  →  Promise.allSettled (parallel)
any tool lacks readOnlyHint         →  sequential execution
```

This is enforced in `AgentCore.processMessage` — only `readOnlyHint: true` tools participate in parallel batches. Mixed batches (e.g. `read_file` + `write_file`) always run sequentially.

Set `readOnlyHint: true` **only** when the tool has zero side effects. A tool that writes logs, mutates session state, or spawns processes must not set it.

### LLM tool schema

Annotations are attached to the tool definition sent to the LLM provider:

```typescript
function: {
  name: 'read_file',
  description: '...',
  parameters: { ... },
  annotations: { title: 'Read File', readOnlyHint: true, idempotentHint: true }
}
```

Providers that support MCP-style tool hints can use these fields to reason about safe parallelization or destructive operations.

### Confirmation policy (separate from annotations)

File writes and shell commands are gated by **ConfirmationPolicy** presets (`default`, `yolo`, `plan`, etc.) — not by `destructiveHint`. The `destructiveHint` flag documents intent for the LLM; actual prompts come from the policy + `CommandSafetyGate`.

In **plan mode**, mutating tools (`write_file`, `patch_file`, `bash`) are removed from the tool list entirely — independent of annotations.

## Built-in tool annotation matrix

| Tool | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` |
|------|:--------------:|:-----------------:|:----------------:|:---------------:|
| `read_file` | ✅ | | ✅ | |
| `write_file` | | ✅ | | |
| `str_replace` | | ✅ | | |
| `patch_file` | | ✅ | | |
| `list_directory` | ✅ | | ✅ | |
| `bash` | | ✅ | | ✅ |
| `glob` | ✅ | | ✅ | |
| `grep_search` | ✅ | | ✅ | |
| `index_workspace` | | | | |
| `semantic_search` | ✅ | | ✅ | |
| `web_fetch` | ✅ | | ✅ | ✅ |
| `delegate_task` | | | | ✅ |

`index_workspace` has no annotations — it mutates the in-memory vector index (session state), so it is not read-only and runs sequentially.

## Adding annotations to a core tool

In `packages/core/src/features/tools/my_tool.ts`:

```typescript
export const myTool = (ctx: ToolContext): CoreToolDefinition<typeof schema> => ({
  name: 'my_tool',
  description: 'What the tool does.',
  annotations: {
    title: 'My Tool',
    readOnlyHint: true,      // only if truly side-effect free
    idempotentHint: true,    // optional — same args → same result
  },
  schema,
  handler: async (args) => { ... }
});
```

Register the tool in `packages/core/src/core-tools.ts`.

**Rules:**

- `readOnlyHint: true` → enables parallel execution with other read-only tools
- Never set `readOnlyHint` on tools that write files, run commands, or modify session state
- `destructiveHint` and `openWorldHint` are advisory — document intent accurately
- Use `ctx.resolveWorkspacePath()` for all file paths

## Plugin tools

The Plugin SDK (`@ak-coder/sdk`) does not yet expose an `annotations` field on `registerTool`. Plugin tools always run sequentially when batched with other calls. Core-tool annotation rules above apply when adding annotation support to the SDK in the future.

See [Building a Plugin](/docs/plugins/building) for plugin authoring.
