# Milestone 10: Evals & Test Coverage Hardening

## Objectives
Establish an automated evaluation framework to test core flow logic and harden unit test suites to 85%+ code coverage.

## Deliverables
- [ ] Build an automated test evaluation engine in `packages/core` that plays back conversation dialogues, simulates file structure failures, and asserts outcomes.
- [ ] Test the following agentic loops in evals:
  *   Compaction and context summarization boundary triggers.
  *   History resumes and conversation branching forks.
  *   Bash tool risk classification and safety block confirmations.
  *   Headless stdio JSON-RPC handshake, requests, and tool integrations.
- [ ] Implement coverage metrics reporter.
- [ ] Refactor and harden tests to achieve a minimum of 85% overall coverage.

## Verification
- Run the full evaluation suite and assert all simulated scenarios pass.
- Run `bun test --coverage` and verify coverage statistics meet or exceed target threshold.
