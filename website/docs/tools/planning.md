---
sidebar_position: 5
---

# Planning & Agent Tools

## Plan mode

Plan mode prevents the agent from making any file writes or running commands. It's designed for structured planning conversations.

Enter with `/plan` in the REPL, or the LLM can enter it via `enter_plan_mode`. The LLM uses `create_plan` to write a structured plan, then `exit_plan_mode` to return to normal mode.

## web_fetch

Fetches a URL and returns the text content (HTML stripped).

**Parameters:**
- `url` (string) — URL to fetch
- `maxLength` (number, optional) — character limit on response (default: 8000)

Timeout: 15 seconds. Non-2xx responses are returned as informational strings.

## delegate_task

Spawns a sub-agent with its own isolated context to handle a subtask. The result is returned to the parent agent.

**Parameters:**
- `task` (string) — description of what the sub-agent should do
- `context` (string, optional) — additional context to pass

Sub-agents have a depth limit (default: 3) to prevent infinite delegation chains. They share the same workspace and LLM provider as the parent.
