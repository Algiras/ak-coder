---
sidebar_position: 3
---

# OpenRouter

[OpenRouter](https://openrouter.ai) routes to 100+ models from one API. Has a free tier with rate limits.

## Quick setup

```bash
OPEN_ROUTER_KEY=sk-or-v1-... bunx @algiras/ak-coder
```

This automatically configures openrouter as the active provider.

## Config

```json
{
  "activeProvider": "openrouter",
  "providers": {
    "openrouter": {
      "apiKey": "sk-or-v1-...",
      "baseUrl": "https://openrouter.ai/api/v1",
      "model": "google/gemma-3-27b-it:free"
    }
  }
}
```

## Free models

Models with `:free` suffix are free with rate limits. Good options:
- `google/gemma-3-27b-it:free`
- `meta-llama/llama-3.3-70b-instruct:free`
- `mistralai/mistral-7b-instruct:free`
