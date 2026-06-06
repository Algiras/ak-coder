---
sidebar_position: 1
---

# Installation

## Requirements

- [Bun](https://bun.sh) ≥ 1.0 (recommended) or Node.js ≥ 18
- An LLM provider — [Ollama](https://ollama.com) (free, local) or a cloud API key

## Run without installing (npm package)

The published CLI is **`@algiras/ak-coder`**. It bundles `@ak-coder/core` — no separate core install needed.

```bash
bunx @algiras/ak-coder
```

Or with npm/npx:

```bash
npx @algiras/ak-coder
```

:::tip Corporate / custom npm registry

If `bunx` or `npx` fails with `ConnectionRefused` or tries to reach a private registry (e.g. `npm.dev.wixpress.com`), your global `~/.npmrc` is overriding the public registry. Point at npmjs for this package:

```bash
NPM_CONFIG_REGISTRY=https://registry.npmjs.org bunx @algiras/ak-coder
NPM_CONFIG_REGISTRY=https://registry.npmjs.org npx @algiras/ak-coder
```

Or install globally with an explicit registry:

```bash
npm install -g @algiras/ak-coder --registry https://registry.npmjs.org
```

:::

## Install globally

```bash
# Bun
bun install -g @algiras/ak-coder
ak-coder

# npm
npm install -g @algiras/ak-coder
ak-coder
```

## Clone and run (monorepo)

For hacking on ak-coder itself, or to use unpublished workspace packages (`@ak-coder/core`, `@ak-coder/sdk`):

```bash
git clone https://github.com/Algiras/ak-coder
cd ak-coder
bun install          # links all workspace packages
bun start            # same as bun run apps/cli/src/index.ts
```

### Monorepo packages

| Package | Name | Published to npm |
|---------|------|------------------|
| CLI | `@algiras/ak-coder` | ✅ [npm](https://www.npmjs.com/package/@algiras/ak-coder) |
| Core agent | `@ak-coder/core` | ❌ workspace only (bundled into CLI on publish) |
| Plugin SDK | `@ak-coder/sdk` | ❌ workspace only — install via path (see [Building a Plugin](/docs/plugins/building)) |
| Eval harness | `@ak-coder/evals` | ❌ workspace only — run from repo root |

Build the publishable CLI bundle:

```bash
bun run build:cli     # outputs apps/cli/dist/index.js
```

Run evals (requires Ollama):

```bash
bun run packages/evals/run.ts
```

## Setting up Ollama (local, free)

```bash
# macOS
brew install ollama
ollama serve          # starts the server at localhost:11434
ollama pull gemma3:4b # download a model (~3GB)
```

On first run ak-coder auto-detects Ollama and uses `gemma3:4b` if available.

## Bootstrap a workspace

```bash
bunx @algiras/ak-coder init
# if bunx fails (corporate registry), use:
NPM_CONFIG_REGISTRY=https://registry.npmjs.org bunx @algiras/ak-coder init
# or from a clone:
bun start init
```

Creates `AGENTS.md` and `.akcoderignore` in the current directory.

See [Configuration](/docs/getting-started/configuration) for CLI flags (`--plan`, `--sandbox`) and provider setup.

## Using a cloud provider

Set your key as an environment variable:

```bash
# OpenRouter (has a free tier)
OPEN_ROUTER_KEY=sk-or-... bunx @algiras/ak-coder

# Gemini
GEMINI_API_KEY=... bunx @algiras/ak-coder
```

Or configure it permanently in `~/.ak-coder/config.json` — see [Configuration](/docs/getting-started/configuration).
