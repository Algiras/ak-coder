# PRD-03: LLM Integration, Token Management & Compaction

## Overview
The LLM Integration module (`packages/core`) manages all interactions with LLM endpoints. It abstracts the model provider via a standard Port interface and supports OpenAI-compatible endpoints, token calculation, usage pricing, and context compaction.

## Requirements

### 1. LLM Provider Adapter
*   **OpenAI Compatibility**: Built on top of the Vercel AI SDK (`ai` and `@ai-sdk/openai`), allowing users to connect to official OpenAI models, local Ollama endpoints, DeepSeek, or OpenRouter via a standard OpenAI-compatible API base URL and key.
*   **Streaming Support**: Supports real-time streaming tokens with cancellation capabilities.

### 2. Token & Cost Accounting
*   **Token Counting**: Uses `tiktoken` (or approximate lightweight token counters) to track context usage before sending requests.
*   **Cost Calculation**: Reads cost config structures (e.g. `$ per 1M input tokens` and `$ per 1M output tokens`) from `config.json` and calculates the price of each completion.
*   **Usage Report**: Prints the input/output tokens used and the estimated API cost at the end of each assistant response.

### 3. Context Compaction (Summarization Loop)
*   **Threshold Trigger**: If the total session context length exceeds a user-configured limit (e.g., 80% of model context window or 16,000 tokens), compaction is triggered.
*   **Summarization**: The core calls the LLM with a specialized compaction prompt to summarize the oldest 50% of the conversation.
*   **State Injection**: The summarized transcript is injected as a system instruction at the beginning of the context, and the raw messages of the oldest segment are purged from memory, keeping the overall context window size stable.
