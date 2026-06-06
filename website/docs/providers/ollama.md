---
sidebar_position: 2
---

# Ollama

[Ollama](https://ollama.com) runs LLMs locally on your machine. Free, private, no API keys.

## Setup

```bash
# macOS
brew install ollama
ollama serve

# Pull models
ollama pull gemma3:4b        # fast, 4GB
ollama pull llama3.2         # strong reasoning
ollama pull qwen2.5-coder    # optimized for code
```

## Config

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

## Auto-detection

If `ollama` is not in your config, ak-coder tries `http://127.0.0.1:11434/api/tags` at startup and picks the first available model from a preference list: `gemma4:31b-cloud`, `gemma4:12b-mlx`, `gemma4:latest`.
