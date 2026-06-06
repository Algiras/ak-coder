---
sidebar_position: 1
slug: /docs/plugins
---

# Plugins & Skills

ak-coder can be extended in two ways:

| Extension | What it adds | Where |
|-----------|-------------|-------|
| **Plugin** | New tools the LLM can call | `.ak-coder/plugins/<name>/` |
| **Skill** | New slash commands (`/mycommand`) | Any `SKILL.md` in the workspace |

Plugins run as local MCP (Model Context Protocol) servers — spawned as child processes, communicating over stdio JSON-RPC.
