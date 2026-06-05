# Milestone 4: LLM Client & Session Forking

## Objectives
Connect the core to LLM providers using Vercel AI SDK, log and serialize conversation turns to disk, and support resuming or branching sessions.

## Deliverables
- [ ] Implement `LLMService` adapter using Vercel AI SDK (`ai` + `@ai-sdk/openai`), resolving model, api key, and base URL from local/global config.
- [ ] Implement local config loading and zod schema validation for `.ak-coder/config.json`.
- [ ] Implement `SessionStore` saving chat histories in JSONL format under `~/.ak-coder/history/`.
- [ ] Build `/history`, `/resume`, and `/fork` commands:
  *   `/history` lists active session IDs and timestamps.
  *   `/resume <session_id>` reloads message history into current agent state.
  *   `/fork <turn_index>` duplicates the history up to `turn_index` and opens a new session.
- [ ] Integrate token counting and cost reporting at the bottom of agent responses.
- [ ] Implement `/ping` command testing API latency.

## Verification
- Write unit tests for session serialization, resuming, and forking. Assert that duplicate sessions branch cleanly.
- Run `/ping` in the CLI and verify successful API response time outputs.
