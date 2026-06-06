---
sidebar_position: 1
slug: /docs/providers
---

# Providers

ak-coder works with any OpenAI-compatible LLM endpoint. Providers are configured in `~/.ak-coder/config.json`.

## Supported providers

| Provider | Type | Free tier |
|----------|------|-----------|
| [Ollama](./ollama) | Local | ✅ Always free |
| [OpenRouter](./openrouter) | Cloud | ✅ Free models available |
| [Gemini](./others#gemini) | Cloud | ✅ Free quota |
| [Groq](./others#groq) | Cloud | ✅ Free tier |
| [DeepSeek](./others#deepseek) | Cloud | ❌ Pay-per-token |
| Any OpenAI-compatible | Cloud/Local | Varies |

## Switching providers at runtime

```
/providers
```

Lists all configured providers and lets you switch interactively.
