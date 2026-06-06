---
sidebar_position: 1
---

# Eval Harness

ak-coder ships with an LLM-as-judge evaluation suite in `packages/evals/`. It tests agent behavior end-to-end against a real LLM (Ollama by default).

## Quick start

```bash
# Requires Ollama running with a judge model
bun run packages/evals/run.ts
```

See [Running Evals](/docs/evals/running) for filters, CI usage, and troubleshooting.

## What evals test

19 built-in eval cases covering:

| Area | Cases |
|------|-------|
| File tools | `read_file`, `write_file`, `str_replace`, `patch_file` |
| Shell | `bash` (echo, read-only gate) |
| Search | `glob`, `grep_search`, `semantic_search` |
| Agent | `delegate_task`, plan mode, skills (load + create/invoke) |
| Session | Multi-turn context, compaction retention |
| Network | `web_fetch` real URL |
| Snapshots | Golden file-state comparisons |

The **skills** evals include a multi-step case where the agent creates a `SKILL.md`, reloads, and invokes it via the same `Apply Skill` message the REPL uses.

## Criterion types

**Static** (`check.*`) — deterministic assertions: did the tool get called? does the file contain X? did the response match a regex?

**Judge** (`judge(...)`) — LLM-graded: a local Ollama model evaluates the agent's response against a natural-language criterion.

See [Writing Evals](/docs/evals/writing-evals) for the full API — `check.toolCalled`, `check.fileContains`, `check.skillInvoked`, custom `run()` flows, and snapshot tests.

## Related docs

- [Tool reference](/docs/tools) — what each built-in tool does and its [annotations](/docs/tools/annotations)
- [Confirmation policy](/docs/adrs/confirmation_policy) — how plan mode and write gates affect eval behavior
