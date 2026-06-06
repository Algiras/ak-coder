# packages/sdk/src — Plugin SDK conventions

## Purpose

The Plugin SDK is the public API for building ak-coder plugins. Plugins run as local MCP (Model Context Protocol) servers that the agent discovers and spawns from `.ak-coder/plugins/*/plugin.json`.

## Files

| File | Purpose |
|------|---------|
| `index.ts` | `PluginSDK` class — MCP stdio server, tool registry, JSON-RPC dispatch |

---

## How to Build a Plugin

### 1. Create the manifest

```
.ak-coder/plugins/
  my-plugin/
    plugin.json     ← discovery manifest
    index.ts        ← spawned by AgentCore; communicates over stdio JSON-RPC
```

`plugin.json`:
```json
{ "name": "my-plugin", "command": "bun", "args": ["run", ".ak-coder/plugins/my-plugin/index.ts"] }
```

### 2. Register tools with `registerTool`

```ts
import { PluginSDK } from '@ak-coder/sdk';
import { z } from 'zod';

const sdk = new PluginSDK();

sdk.registerTool({
  name: 'my_tool',
  description: 'Description shown to the LLM',
  schema: z.object({
    input: z.string().describe('What this parameter does'),
  }),
  handler: async (args) => {
    return `Result: ${args.input}`;
  }
});

sdk.start();
```

The handler return value can be any JSON-serializable value — strings are most common.

### 3. Optional: declare output schema

```ts
sdk.registerTool({
  name: 'query_db',
  schema: z.object({ sql: z.string() }),
  outputSchema: z.object({ rows: z.array(z.record(z.string())) }),
  handler: async ({ sql }) => { ... }
});
```

`outputSchema` is advisory — the agent logs a warning if the output doesn't match, but doesn't abort.

---

## How to Add a New SDK Capability

The SDK currently only supports `tools`. MCP also defines `resources` and `prompts`. To add one:

1. Add a new registry to `PluginSDK` (e.g. `private resources = new Map<string, ResourceDefinition>()`).
2. Add a public `registerResource(...)` method.
3. Handle the corresponding MCP method in the `start()` `rl.on('line', ...)` dispatch:
   - `resources/list` → return registered resources
   - `resources/read` → call the resource handler
4. Update `McpClient` in `packages/core/src/mcp.ts` to call the new method (if the agent should use it).
5. Expose the data in a new core tool if needed.

---

## MCP Protocol Notes

| Method | Direction | Purpose |
|--------|-----------|---------|
| `initialize` | agent → plugin | Handshake; plugin returns tool list |
| `notifications/initialized` | agent → plugin | Post-handshake notification; plugin ignores it |
| `tools/list` | agent → plugin | Re-fetch tool list |
| `tools/call` | agent → plugin | Invoke a tool with JSON arguments |

- **stdout** is the JSON-RPC transport. Never write to stdout from plugin code — use `console.error` instead. `PluginSDK` redirects `console.log` to stderr automatically.
- Tool results are wrapped as `{ content: [{ type: 'text', text }] }` by `McpClient`.
