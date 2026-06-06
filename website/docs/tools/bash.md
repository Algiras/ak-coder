---
sidebar_position: 3
---

# Bash Tool

Runs shell commands in the workspace root.

**Annotations:** destructive · open-world

**Parameters:**
- `command` (string, required) — shell command to execute

## Safety gate

Commands are classified as **safe** (read-only: `cat`, `ls`, `git status`, etc.) or **unsafe** (writes, network, destructive). Safe commands run without confirmation. Unsafe commands prompt for approval unless the session policy is `yolo`.

Once you approve a command pattern, it is auto-approved for the rest of the session via the safety gate's pattern authorizer.

## Hooks

Plugins can intercept bash via `beforeExecuteCommand` / `afterExecuteCommand` hooks — for example to log commands, block certain patterns, or rewrite the command string before execution.

## Sandbox mode

Run ak-coder with `--sandbox` to execute all bash commands inside a Docker container:

```bash
ak-coder --sandbox
```

This mounts the workspace read-only and gives the agent an isolated environment for running untrusted commands.
