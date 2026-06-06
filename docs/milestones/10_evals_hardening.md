# Milestone 10: Evals & Test Coverage Hardening

## Objectives
Establish an automated evaluation framework to test core flow logic and harden unit test suites to 85%+ code coverage.

## Deliverables
- [x] Build an automated test evaluation engine in `packages/core` that plays back conversation dialogues, simulates file structure failures, and asserts outcomes.
- [x] Test the following agentic loops in evals:
  *   Compaction and context summarization boundary triggers.
  *   History resumes and conversation branching forks.
  *   Bash tool risk classification and safety block confirmations.
  *   Headless stdio JSON-RPC handshake, requests, and tool integrations.
- [x] Implement coverage metrics reporter (`bun run test:coverage`, `bun run test:coverage:check`).
- [x] Refactor and harden tests to achieve a minimum of 85% overall coverage.

## Notes
- Ollama E2E evals gated behind `RUN_OLLAMA_EVALS=1` env var to avoid CI timeouts. Preferred model: `gemma4:31b-cloud`.
- `grep_search` tool uses `rg` (ripgrep) via `ProcessRunner` when available; falls back to in-process scan in test environments.
- `MockTerminalIo.confirm()` now defaults to **deny** — tests must explicitly seed `confirmResults` for approval.

## Verification
- Run the full evaluation suite and assert all simulated scenarios pass.
- Run `bun test --coverage` and verify coverage statistics meet or exceed target threshold.
