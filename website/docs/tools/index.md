---
sidebar_position: 1
slug: /docs/tools
---

# Tools Overview

ak-coder gives the LLM 15 built-in tools. Each tool is defined in `packages/core/src/features/tools/` and registered in `core-tools.ts`.

| Tool | Category | Read-only |
|------|----------|-----------|
| `read_file` | File | ✅ |
| `write_file` | File | ❌ |
| `str_replace` | File | ❌ |
| `patch_file` | File | ❌ |
| `list_directory` | File | ✅ |
| `bash` | Shell | ❌ |
| `glob` | Search | ✅ |
| `grep_search` | Search | ✅ |
| `semantic_search` | Search | ✅ |
| `index_workspace` | Search | ✅ |
| `web_fetch` | Network | ✅ |
| `delegate_task` | Agent | ❌ |
| `enter_plan_mode` | Planning | ✅ |
| `exit_plan_mode` | Planning | ✅ |
| `create_plan` | Planning | ❌ |

Read-only tools run in **parallel** when the LLM calls multiple in one turn. Write tools are always sequential.
