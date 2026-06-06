---
sidebar_position: 2
---

# Configuration

ak-coder stores all config in `~/.ak-coder/config.json`. It is created automatically on first run.

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
| `assistantName` | Name shown in the REPL (default: `AKCoder`) |
| `contextTokens` | Max context window size (default: `128000`) |

## REPL commands for config

```
/providers     — list all configured providers and switch active one
/config        — show path to config file
```

## Environment variables

| Variable | Effect |
|----------|--------|
| `OPEN_ROUTER_KEY` | Sets OpenRouter API key and makes openrouter the active provider |
