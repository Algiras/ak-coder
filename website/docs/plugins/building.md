---
sidebar_position: 2
---

# Building a Plugin

## 1. Create the manifest

```
.ak-coder/plugins/
  my-plugin/
    plugin.json
    package.json      ← optional but recommended for dependencies
    index.ts
```

`plugin.json`:
```json
{
  "name": "my-plugin",
  "command": "bun",
  "args": ["run", ".ak-coder/plugins/my-plugin/index.ts"]
}
```

## 2. Implement the plugin

```typescript
import { PluginSDK } from '@ak-coder/sdk';
import { z } from 'zod';

const sdk = new PluginSDK();

sdk.registerTool({
  name: 'my_tool',
  description: 'Description shown to the LLM — be specific',
  schema: z.object({
    input: z.string().describe('What this parameter does'),
  }),
  handler: async (args) => {
    return `Result: ${args.input}`;
  }
});

sdk.start();
```

## 3. Install dependencies

`@ak-coder/sdk` is **not published to npm** — it lives in the ak-coder monorepo. Install it from a local checkout:

```bash
cd .ak-coder/plugins/my-plugin
bun init -y
bun add zod
bun add file:/path/to/ak-coder/packages/sdk
```

Example when ak-coder is cloned next to your project:

```bash
bun add file:../../ak-coder/packages/sdk
```

Your plugin `package.json` should look like:

```json
{
  "name": "my-plugin",
  "type": "module",
  "dependencies": {
    "@ak-coder/sdk": "file:../../ak-coder/packages/sdk",
    "zod": "^3.23.8"
  }
}
```

If you are developing inside the ak-coder repo itself, `bun install` at the repo root already links workspace packages — point `plugin.json` at your plugin script and import `@ak-coder/sdk` directly.

## Key rules

- **Never write to stdout** — it's the JSON-RPC transport. Use `console.error` for debugging (the SDK redirects `console.log` to stderr automatically).
- Tool handler return values can be any JSON-serializable value; strings are most common.
- Add an `outputSchema` (zod) to declare expected output shape — mismatches log a warning but don't abort.
- Plugin tools do not yet support [tool annotations](/docs/tools/annotations) (`readOnlyHint`, etc.) — all plugin tool calls run sequentially.

For core-tool annotation semantics (parallel execution, side-effect hints), see [Tool Annotations](/docs/tools/annotations).

## Testing your plugin

Start ak-coder and ask the agent to use your tool:

```
> call my_tool with input "hello"
```

Check the logs in `~/.ak-coder/logs/` if something isn't working.
