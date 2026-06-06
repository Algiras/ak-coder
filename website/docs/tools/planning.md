---
sidebar_position: 5
---

# Planning & Agent Tools

## Plan mode

Plan mode prevents the agent from making file writes or running shell commands — it can only read, search, and reason. Use it for structured planning before committing to changes.

### Activating plan mode

| Method | How |
|--------|-----|
| REPL | `/plan on` — toggle off with `/plan off` |
| CLI flag | `ak-coder --plan` at startup |
| Preset | Sets confirmation policy to `plan` |

When active, the agent:

1. **Filters** `write_file`, `patch_file`, and `bash` from the tool list exposed to the LLM
2. **Denies** any mutating action at the confirmation policy layer (defense in depth)
3. **Injects** a `PLAN MODE ACTIVE` directive into the system prompt

Read-only tools (`read_file`, `glob`, `grep_search`, `semantic_search`, etc.) remain available.

### Saving and reviewing plans

Plans are saved as markdown under `.ak-coder/plans/`:

```
/plan list              — list saved plan files (newest first)
/plan show <filename>   — display a saved plan
/plan <text>            — save freeform plan text and choose next steps
```

When you type `/plan <text>`, ak-coder writes `plan-<timestamp>-<hex4>.md` and offers to suggest changes, start a fresh session with the plan as context, or continue in the current session.

When the agent produces a plan response while plan mode is active, the `onPlanProduced` hook serializes it to the same plans directory automatically.

To execute a plan, exit plan mode (`/plan off`) or restart without `--plan`, then ask the agent to implement it.

See [ADR 11: Plan Mode Gating](/docs/adrs/plan_mode_gating) for the full design.

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

Because sub-agents run the full agent loop, `delegate_task` is not read-only and never runs in parallel with other tools.
