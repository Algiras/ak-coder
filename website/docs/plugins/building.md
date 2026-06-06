---
sidebar_position: 2
---

# Building a Plugin

## 1. Create the manifest

```
.ak-coder/plugins/
  my-plugin/
    plugin.json
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

## 3. Install the SDK

```bash
bun add @ak-coder/sdk
```

## Key rules

- **Never write to stdout** — it's the JSON-RPC transport. Use `console.error` for debugging (the SDK redirects `console.log` to stderr automatically).
- Tool handler return values can be any JSON-serializable value; strings are most common.
- Add an `outputSchema` (zod) to declare expected output shape — mismatches log a warning but don't abort.

## Testing your plugin

Start ak-coder and call your tool:
```
> use my_tool with input "hello"
```

Check the logs in `~/.ak-coder/logs/` if something isn't working.
