---
sidebar_position: 3
---

# Bash Tool

Runs shell commands in the workspace root.

**Parameters:**
- `command` (string) — shell command to execute
- `timeout` (number, optional) — timeout in seconds (default: 30)

## Safety gate

Commands are classified as **safe** (read-only: `cat`, `ls`, `git status`, etc.) or **unsafe** (writes, network, destructive). Safe commands run without confirmation. Unsafe commands prompt for approval unless the session policy is `yolo`.

Classifications persist per-session: if you approve `npm install`, it's auto-approved for the rest of the session.

## Sandbox mode

Run ak-coder with `--sandbox` to execute all bash commands inside a Docker container:

```bash
ak-coder --sandbox
```

This mounts the workspace read-only and gives the agent an isolated environment for running untrusted commands.
