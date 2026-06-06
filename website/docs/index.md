---
sidebar_position: 1
---

# ak-coder

**A hackable LLM agent harness for the terminal.**

ak-coder connects to any OpenAI-compatible LLM and gives it a full set of developer tools. Run it with Ollama for a free local setup, or point it at any cloud provider.

## Get started

- [Installation](/docs/getting-started/installation) — `bunx @algiras/ak-coder` or clone and run
- [Configuration](/docs/getting-started/configuration) — providers, API keys, CLI flags
- [First Run](/docs/getting-started/first-run) — REPL commands, confirmation policy, plan mode

## Reference

| Section | What's inside |
|---------|---------------|
| [Tools](/docs/tools) | All 12 built-in tools and [annotations](/docs/tools/annotations) |
| [Providers](/docs/providers) | Ollama, OpenRouter, Gemini, Groq, DeepSeek |
| [Plugins & Skills](/docs/plugins) | MCP plugins and `SKILL.md` slash commands |
| [Eval Harness](/docs/evals) | LLM-as-judge eval suite (18 cases) |
| [Architecture](/docs/architecture/flows) | ReAct loop, confirmation flow, MCP, compaction |
| [ADRs](/docs/adrs) | Architecture decision records |

## Quick links

```bash
bunx @algiras/ak-coder              # start REPL (npm package)
bun start                           # from monorepo clone
bun run packages/evals/run.ts       # run eval suite
bun test                            # unit tests
```
