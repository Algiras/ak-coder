---
sidebar_position: 1
---

# Providers

ak-coder works with any OpenAI-compatible LLM endpoint. Providers are configured in `~/.ak-coder/config.json`.

## Supported providers

| Provider | Type | Free tier |
|----------|------|-----------|
| [Ollama](/docs/providers/ollama) | Local | ✅ Always free |
| [OpenRouter](/docs/providers/openrouter) | Cloud | ✅ Free models available |
| [Gemini](/docs/providers/others#gemini) | Cloud | ✅ Free quota |
| [Groq](/docs/providers/others#groq) | Cloud | ✅ Free tier |
| [DeepSeek](/docs/providers/others#deepseek) | Cloud | ❌ Pay-per-token |
| Any OpenAI-compatible | Cloud/Local | Varies |

## Switching providers at runtime

```
/providers
```

Lists all configured providers and lets you switch interactively. See [Configuration](/docs/getting-started/configuration) for the full config schema and environment variables.
