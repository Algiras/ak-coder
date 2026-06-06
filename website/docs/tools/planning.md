---
sidebar_position: 5
---

# Planning & Agent Tools

## Plan mode

Plan mode prevents the agent from making any file writes or running commands — it can only read, search, and reason. Use it for structured planning conversations before committing to changes.

Enter with `/plan` in the REPL, or the LLM can enter via `enter_plan_mode`. Inside plan mode, the LLM uses `create_plan` to write a structured plan file, then `exit_plan_mode` to return to normal execution mode.

**Tools available in plan mode:**
- `enter_plan_mode` — activates plan mode (read-only · idempotent)
- `create_plan` — writes the plan to `.ak-coder/plan.md`
- `exit_plan_mode` — deactivates plan mode and returns full tool access

---

## web_fetch

Fetches the text content of a URL. HTML is stripped to plain text.

**Annotations:** read-only · idempotent · open-world

**Parameters:**
- `url` (string, required) — URL to fetch
- `maxLength` (number, optional) — maximum characters to return (default: 8000)

Timeout: 15 seconds. Non-2xx responses are returned as informational strings rather than exceptions. Useful for reading documentation, npm pages, GitHub issues, and API references.

---

## delegate_task

Spawns a sub-agent with its own isolated context to handle a subtask. The sub-agent runs the full ReAct loop and returns its findings to the parent agent.

**Annotations:** open-world

**Parameters:**
- `role` (string, required) — the specialized role of the sub-agent, e.g. `"Security Auditor"`, `"Test Runner"`
- `taskPrompt` (string, required) — detailed instructions and objective for the sub-agent
- `filesToInclude` (string[], optional) — workspace-relative paths of files to pre-load into the sub-agent's context

Sub-agents share the same workspace root and LLM provider as the parent. Delegation depth is capped at **3** to prevent infinite chains. Each level receives a fresh session with no parent history.
