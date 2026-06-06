---
sidebar_position: 1
---

# Installation

## Requirements

- [Bun](https://bun.sh) ≥ 1.0 or Node.js ≥ 18
- An LLM provider — [Ollama](https://ollama.com) (free, local) or a cloud API key

## Run without installing

```bash
bunx @algiras/ak-coder
```

Or with npm/npx:

```bash
npx @algiras/ak-coder
```

## Install globally

```bash
bun install -g @algiras/ak-coder
ak-coder
```

## Clone and run

```bash
git clone https://github.com/Algiras/ak-coder
cd ak-coder
bun install
bun run apps/cli/src/index.ts
```

## Setting up Ollama (local, free)

```bash
# macOS
brew install ollama
ollama serve          # starts the server at localhost:11434
ollama pull gemma3:4b # download a model (~3GB)
```

On first run ak-coder auto-detects Ollama and uses `gemma3:4b` if available.

## Using a cloud provider

Set your key as an environment variable:

```bash
# OpenRouter (has a free tier)
OPEN_ROUTER_KEY=sk-or-... bunx @algiras/ak-coder

# Gemini
GEMINI_API_KEY=... bunx @algiras/ak-coder
```

Or configure it permanently in `~/.ak-coder/config.json` — see [Configuration](./configuration).
