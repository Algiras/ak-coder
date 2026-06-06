---
sidebar_position: 1
slug: /docs/evals
---

# Eval Harness

ak-coder ships with an LLM-as-judge evaluation suite in `packages/evals/`. It tests agent behavior end-to-end against a real LLM.

## What evals test

18 built-in eval cases covering:

| Area | Cases |
|------|-------|
| File tools | `read_file`, `write_file`, `str_replace`, `patch_file` |
| Shell | `bash` (echo, read-only gate) |
| Search | `glob`, `grep_search`, `semantic_search` |
| Agent | `delegate_task`, `plan` mode, `skills` |
| Session | Multi-turn context, compaction retention |
| Network | `web_fetch` real URL |
| Snapshots | Golden file-state comparisons |

## Criterion types

**Static** (`check.*`) — deterministic: did the tool get called? does the file contain X?

**Judge** (`judge(...)`) — LLM-graded: a local Ollama model evaluates the agent's response against a natural-language criterion.
