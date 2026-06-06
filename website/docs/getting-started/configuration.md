---
sidebar_position: 2
---

# Configuration

ak-coder stores global config in `~/.ak-coder/config.json`. It is created automatically on first run. Project-level overrides merge on top from `.ak-coder/config.json` in the workspace root.

## Minimal config (Ollama)

```json
{
  "activeProvider": "ollama",
  "providers": {
    "ollama": {
      "apiKey": "ollama",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "model": "gemma3:4b"
    }
  }
}
```

## Multi-provider config

```json
{
  "activeProvider": "openrouter",
  "providers": {
    "ollama": {
      "apiKey": "ollama",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "model": "gemma3:4b"
    },
    "openrouter": {
      "apiKey": "sk-or-v1-...",
      "baseUrl": "https://openrouter.ai/api/v1",
      "model": "google/gemma-3-27b-it:free"
    },
    "gemini": {
      "apiKey": "AIza...",
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
      "model": "gemini-1.5-flash"
    }
  }
}
```

## Config fields

| Field | Description |
|-------|-------------|
| `activeProvider` | Which provider key to use by default |
| `providers.<name>.baseUrl` | OpenAI-compatible endpoint URL |
| `providers.<name>.apiKey` | API key (`"ollama"` for local Ollama) |
| `providers.<name>.model` | Model name string |
| `providers.<name>.costInput` | Input cost per 1M tokens (for `/budget`) |
| `providers.<name>.costOutput` | Output cost per 1M tokens |
| `assistantName` | Label for assistant messages in the REPL (default: `AKCoder`) |
| `systemName` | Product name in the banner (default: `ak-coder`) |
| `contextTokens` | Max context window size (default: `128000`) |
| `mcpServers` | MCP server definitions (merged with project config) |

Provider presets for `groq`, `gemini`, `deepseek`, and `openrouter` are auto-populated on first load if missing, using environment variables when available.

## REPL commands for config

```
/providers              — list providers and switch interactively
/providers select ollama  — switch active provider
/providers set ollama model gemma3:4b  — update a provider field
/settings               — view editable settings
/settings contextTokens 200000         — change a setting at runtime
/model                  — pick a model (Ollama picker when available)
/model llama3.2         — set model directly
```

Config file path: `~/.ak-coder/config.json`

## Environment variables

| Variable | Effect |
|----------|--------|
| `OPEN_ROUTER_KEY` / `OPENROUTER_API_KEY` | OpenRouter API key (default provider preset) |
| `GEMINI_API_KEY` | Gemini API key |
| `GROQ_KEY` / `GROQ_API_KEY` | Groq API key |
| `DEEPSEEK_API_KEY` | DeepSeek API key |
| `OPENAI_API_KEY` | OpenAI API key (legacy root config) |
| `OPENAI_API_BASE` | OpenAI-compatible base URL override |
| `AK_CODER_DEBUG` | Enable debug trace logging (`1` or `true`) |

## CLI flags

| Flag | Effect |
|------|--------|
| `--plan` | Start in plan mode (no writes or commands) |
| `--sandbox` | Run bash inside Docker |
| `--sandbox-image <image>` | Docker image (default: `node:20-alpine`) |
| `--sandbox-readonly` | Mount workspace read-only in sandbox |
| `--stdio` | JSON-RPC mode on stdin/stdout (no REPL) |
| `--debug` | Trace UI and agent activity to `~/.ak-coder/logs/` |
| `init` | Create `AGENTS.md` and `.akcoderignore` in cwd |

## Debug logging

```bash
ak-coder --debug
# or
AK_CODER_DEBUG=1 ak-coder
```

| File | Contents |
|------|----------|
| `~/.ak-coder/logs/ui.trace.log` | Ink UI events (activity labels, sub-agents, stream phases) |
| `~/.ak-coder/logs/agent.log` | Core agent log (includes tool start/finish at debug level) |

Useful when diagnosing stuck prompts, missing tool activity, or sub-agent rendering.

See [Architecture: Streaming & Debug](/docs/architecture/flows#streaming--debug).

See [Providers](/docs/providers) for per-provider setup guides.
