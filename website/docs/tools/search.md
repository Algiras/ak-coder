---
sidebar_position: 4
---

# Search Tools

## glob

Finds files matching a glob pattern in the workspace.

**Parameters:**
- `pattern` (string) — glob pattern, e.g. `**/*.ts`, `src/**/*.test.ts`

Uses `rg --files -g <pattern>` when ripgrep is available, falls back to in-process scan.

## grep_search

Searches file contents for a regex pattern.

**Parameters:**
- `pattern` (string) — regex pattern
- `path` (string, optional) — directory to search (defaults to workspace root)

## index_workspace + semantic_search

`index_workspace` builds a TF-IDF vector index of all files in the workspace. `semantic_search` then finds the most relevant files for a query.

**index_workspace parameters:**
- `extensions` (string[], optional) — file extensions to index, e.g. `[".ts", ".md"]`

**semantic_search parameters:**
- `query` (string) — natural language query
- `topK` (number, optional) — number of results (default: 5)

The index is in-memory and lives for the session. Re-run `index_workspace` after large file changes.
