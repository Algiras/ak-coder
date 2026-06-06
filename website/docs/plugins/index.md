---
sidebar_position: 1
---

# Plugins & Skills

ak-coder can be extended in two ways:

| Extension | What it adds | Where |
|-----------|-------------|-------|
| **Plugin** | New tools the LLM can call | `.ak-coder/plugins/<name>/` |
| **Skill** | New slash commands (`/mycommand`) | Any `SKILL.md` in the workspace |

## Plugins (MCP tools)

Plugins run as local [MCP](https://modelcontextprotocol.io) (Model Context Protocol) servers — spawned as child processes, communicating over stdio JSON-RPC. At startup, ak-coder discovers every `plugin.json` under `.ak-coder/plugins/` and registers the plugin's tools as `serverName__toolName`.

**Getting started:** [Building a Plugin](/docs/plugins/building)

Key points:

- Use `@ak-coder/sdk` and `registerTool()` — install SDK via `file:…/packages/sdk` from a local checkout; see [Building a Plugin](/docs/plugins/building)
- **Never write to stdout** in plugin code — it's the JSON-RPC transport
- Optional `outputSchema` validates handler output (warns on mismatch, does not abort)
- Plugin tools do not yet support [tool annotations](/docs/tools/annotations) — they always run sequentially
- Lifecycle hooks in `.ak-coder/hooks/` can intercept writes and commands from core tools (not plugin internals)

See [ADR 03: Plugin System & Hooks](/docs/adrs/plugin_system_hooks) and [ADR 07: Plugin Output Schema](/docs/adrs/plugin_output_schema).

## Skills (slash commands)

Skills are markdown instruction files loaded at startup. Typing `/skillname` injects the skill body (plus any arguments) into the agent context.

**Getting started:** [Skills](/docs/plugins/skills)

Key points:

- Any file named `SKILL.md` anywhere in the workspace is discovered automatically
- Front-matter `name` drives the slash command; `description` appears in `/help`
- Skills are instructions for the LLM — they do not add new executable tools

See [ADR 04: Skills System](/docs/adrs/skills_system).
