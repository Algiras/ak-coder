---
sidebar_position: 4
---

# Other Providers

## Gemini {#gemini}

```json
{
  "providers": {
    "gemini": {
      "apiKey": "AIza...",
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
      "model": "gemini-1.5-flash"
    }
  }
}
```

Get a key at [aistudio.google.com](https://aistudio.google.com).

## Groq {#groq}

```json
{
  "providers": {
    "groq": {
      "apiKey": "gsk_...",
      "baseUrl": "https://api.groq.com/openai/v1",
      "model": "llama-3.3-70b-versatile"
    }
  }
}
```

## DeepSeek {#deepseek}

```json
{
  "providers": {
    "deepseek": {
      "apiKey": "sk-...",
      "baseUrl": "https://api.deepseek.com/v1",
      "model": "deepseek-chat"
    }
  }
}
```

## Custom OpenAI-compatible endpoint

Any endpoint that implements the OpenAI chat completions API works:

```json
{
  "providers": {
    "custom": {
      "apiKey": "your-key",
      "baseUrl": "https://your-endpoint.com/v1",
      "model": "your-model"
    }
  }
}
```
