# ADR 08: Core Tools — glob, web_fetch, and str_replace Safety Constraints

## Context
Beyond basic file read/write, the agent needs three utility tools that Claude Code provides: a file-pattern finder (`glob`), a URL fetcher (`web_fetch`), and a targeted string replacer (`str_replace`). Each carries distinct risk: glob could enumerate sensitive paths, web_fetch could exfiltrate data or be used to load malicious payloads, and str_replace could silently corrupt files if the search string matches multiple locations.

## Decision
We implement all three as registered `CoreToolDefinition` entries with explicit safety constraints:

**glob**:
- Runs `rg --files -g <pattern>` via `ProcessRunner` when available; falls back to an in-process regex scan of `MockFileSystem.files` for tests.
- The search root defaults to `workspaceRoot`; traversal is limited to files reachable via `fs.listFiles` (no escaping the workspace).

**web_fetch**:
- Uses the native `fetch()` API with a hard 15-second `AbortSignal.timeout`.
- HTML responses are stripped of `<script>`, `<style>`, and all tags before being returned.
- Output is truncated to 8,000 characters (configurable via `maxLength`) to cap token usage.
- Errors (network failures, non-2xx status) are returned as informational strings, never thrown, so the LLM can handle failures gracefully.

**str_replace**:
- Enforces the Write-Only-After-Read lock: the file must have been read in the current session.
- Rejects the edit if `old_string` appears zero times (not found) or more than once (ambiguous).
- Goes through `ConfirmationPolicy.check('patch_file', ...)` before writing — subject to the same approval flow as `write_file`.

## Consequences
* **Workspace confinement**: glob and str_replace operate within `workspaceRoot`; absolute paths outside the workspace still resolve but the LLM is not given a path escape mechanism.
* **Safe HTML extraction**: Stripping scripts and styles before returning web content prevents prompt-injection via malicious web pages.
* **Uniqueness requirement**: The str_replace ambiguity check trades convenience (no regex) for correctness — callers must provide enough surrounding context to make `old_string` unique.
