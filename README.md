# ak-coder

**A hackable LLM agent harness for the terminal.**

[![CI](https://github.com/Algiras/ak-coder/actions/workflows/ci.yml/badge.svg)](https://github.com/Algiras/ak-coder/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@algiras/ak-coder)](https://www.npmjs.com/package/@algiras/ak-coder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

ak-coder is an open-source coding agent you can run locally, fork, and extend. It connects to any OpenAI-compatible LLM (Ollama, OpenRouter, Gemini, Groq, DeepSeek) and gives it a full set of developer tools — file read/write, bash, semantic search, planning mode, sub-agents, and more.

**[Documentation →](https://algiras.github.io/ak-coder)**

---

## Quick Start

**With Ollama (free, local):**

```bash
# 1. Install Ollama and pull a model
brew install ollama
ollama pull gemma3:4b

# 2. Run ak-coder
bunx @algiras/ak-coder
```

**With OpenRouter (cloud, free tier available):**

```bash
OPEN_ROUTER_KEY=your_key bunx @algiras/ak-coder
```

---

## Features

- **15 built-in tools** — `read_file`, `write_file`, `str_replace`, `patch_file`, `bash`, `glob`, `grep_search`, `semantic_search`, `list_directory`, `web_fetch`, `delegate_task`, `plan`, and more
- **Multi-provider** — Ollama, OpenRouter, Gemini, Groq, DeepSeek, any OpenAI-compatible endpoint
- **Hexagonal architecture** — core agent is fully decoupled from I/O; every component is independently testable
- **Plugin system** — extend with local MCP servers via `plugin.json`
- **Skills** — custom slash commands via `SKILL.md` files
- **Plan mode** — structured planning without mutations
- **Sub-agents** — delegate tasks to parallel agent instances
- **Eval harness** — LLM-as-judge evaluation suite with 18 eval cases

---

## Providers

| Provider | Model example | Setup |
|----------|--------------|-------|
| **Ollama** (local) | `gemma3:4b`, `llama3.2` | `brew install ollama && ollama pull gemma3:4b` |
| **OpenRouter** | `google/gemma-3-27b-it:free` | `OPEN_ROUTER_KEY=...` |
| **Gemini** | `gemini-1.5-flash` | Set API key in config |
| **Groq** | `llama-3.3-70b-versatile` | Set API key in config |
| **DeepSeek** | `deepseek-chat` | Set API key in config |

---

## Configuration

ak-coder stores config in `~/.ak-coder/config.json`. On first run it's created automatically. To switch providers:

```bash
ak-coder /providers   # list configured providers
ak-coder /config      # show current config path
```

Or edit `~/.ak-coder/config.json` directly:

```json
{
  "activeProvider": "ollama",
  "providers": {
    "ollama": {
      "baseUrl": "http://127.0.0.1:11434/v1",
      "model": "gemma3:4b"
    }
  }
}
```

---

## Architecture

ak-coder uses hexagonal architecture — `AgentCore` never imports Node.js APIs directly; all I/O is routed through typed port interfaces that swap between test doubles and real adapters without touching business logic.

**Ports** (`packages/core/src/ports.ts`): `FileSystem` · `TerminalIo` · `ProcessRunner` · `LLMService` · `SessionStore` · `Logger`

**CLI adapters** (`apps/cli/src/adapters/`): `NodeFileSystem` (fs/promises) · `NodeProcessRunner` (child_process) · `NodeTerminalIo` (readline, piped mode) · `InkTerminalIo` (React/Ink rich UI) · `OpenAICompatibleLLMService` (Ollama, OpenRouter, etc.)

**Data flow:** user message → `AgentCore` → ReAct loop → tool calls → port adapters → streamed response

```
packages/
  core/    — AgentCore, ports, ReAct loop
             tools/    — 15 tools: read_file, write_file, str_replace, patch_file,
                         bash, glob, grep_search, semantic_search, list_directory,
                         web_fetch, delegate_task, plan, index_workspace
             history/  — session persistence, TF-IDF vector store, semantic indexer
             skills/   — custom slash commands loaded from SKILL.md files
             rules/    — workspace rules from AGENTS.md / CLAUDE.md
             mcp/      — MCP client for plugin local servers
             hooks/    — plugin lifecycle hooks (beforeWriteFile, afterWriteFile, …)
             confirmation/ — per-action approval policy
             safety/   — path safety, ignore patterns
  sdk/     — plugin.json manifest format; PluginLoader (~/.ak-coder/plugins/)
  evals/   — LLM-as-judge harness: 18 eval cases, multi-provider reports,
             golden snapshot tests
apps/
  cli/     — Node.js terminal REPL (Ink UI + readline fallback)
```

See the [Architecture ADRs](https://algiras.github.io/ak-coder/docs/adrs) for design decisions.

---

## Contributing

```bash
git clone https://github.com/Algiras/ak-coder
cd ak-coder
bun install
bun test              # unit tests
bun run packages/evals/run.ts   # LLM evals (requires Ollama)
```

---

## License

MIT
