---
sidebar_position: 1
---

# Tools Overview

ak-coder gives the LLM **12 built-in tools**. Each tool is defined in `packages/core/src/features/tools/` and registered in `core-tools.ts`.

| Tool | Category | Annotations | Details |
|------|----------|-------------|---------|
| `read_file` | File | read-only · idempotent | [File tools](/docs/tools/read-write#read_file) |
| `write_file` | File | destructive | [File tools](/docs/tools/read-write#write_file) |
| `str_replace` | File | destructive | [File tools](/docs/tools/read-write#str_replace) |
| `patch_file` | File | destructive | [File tools](/docs/tools/read-write#patch_file) |
| `list_directory` | File | read-only · idempotent | [File tools](/docs/tools/read-write#list_directory) |
| `bash` | Shell | destructive · open-world | [Bash](/docs/tools/bash) |
| `glob` | Search | read-only · idempotent | [Search](/docs/tools/search#glob) |
| `grep_search` | Search | read-only · idempotent | [Search](/docs/tools/search#grep_search) |
| `index_workspace` | Search | — | [Search](/docs/tools/search#index_workspace) |
| `semantic_search` | Search | read-only · idempotent | [Search](/docs/tools/search#semantic_search) |
| `web_fetch` | Network | read-only · idempotent · open-world | [Planning & agent](/docs/tools/planning#web_fetch) |
| `delegate_task` | Agent | open-world | [Planning & agent](/docs/tools/planning#delegate_task) |

## Tool annotations

Every tool can declare [annotations](/docs/tools/annotations) — metadata that controls parallel execution, labels the REPL spinner, and informs the LLM about side effects. Read-only tools run in **parallel** when the LLM calls multiple in one turn; all other tools run sequentially.

## Plan mode

Plan mode is not a separate tool — it is a [confirmation preset](/docs/tools/planning) activated via `/plan on` or `--plan`. In plan mode, mutating tools are hidden and writes/commands are denied. See [Planning & Agent Tools](/docs/tools/planning).
