---
sidebar_position: 4
---

# Search Tools

## glob

Finds files matching a glob pattern in the workspace.

**Annotations:** read-only · idempotent

**Parameters:**
- `pattern` (string, required) — glob pattern, e.g. `**/*.ts`, `src/**/*.test.ts`
- `path` (string, optional) — root directory to search (default: workspace root)

Uses `rg --files -g <pattern>` when ripgrep is available, falls back to in-process recursive scan.

---

## grep_search

Searches file contents for a text pattern or regex.

**Annotations:** read-only · idempotent

**Parameters:**
- `pattern` (string, required) — text pattern or regex to search for
- `path` (string, required) — directory to search

---

## index_workspace

Builds a TF-IDF vector index of all workspace files. Must be called once before `semantic_search` can be used. The index lives in memory for the session.

**Parameters:**
- `extensions` (string[], optional) — file extensions to include, e.g. `[".ts", ".md"]`. Defaults to common code and text extensions.

Respects `.gitignore` patterns. Re-run after large file changes to keep the index current.

---

## semantic_search

Searches the indexed workspace for files or code chunks semantically relevant to a natural-language query.

**Annotations:** read-only · idempotent

**Parameters:**
- `query` (string, required) — natural language query, e.g. `"where do we handle JSON-RPC messages"`
- `topK` (number, optional) — maximum number of results to return (default: 5)
- `minScore` (number, optional) — minimum cosine similarity threshold 0–1 (default: 0.1)

Returns ranked chunks with file path and relevance score. Requires `index_workspace` to have been called first.
