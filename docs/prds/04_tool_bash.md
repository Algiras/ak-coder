# PRD-04: Bash Execution & Safety Gates

## Overview
The Bash tool enables the agent to compile projects, run tests, and inspect shell outputs. To protect the developer's system from dangerous commands, we implement a strict safety permission gate and a command risk classifier.

## Requirements

### 1. Bash Tool Core
*   **Subprocess Execution**: Executes shell commands asynchronously using Bun's process APIs.
*   **Output Piping**: Captures and streams stdout and stderr back to the LLM agent session in real time.
*   **Timeouts**: Enforces default timeouts (e.g. 5 minutes) to prevent infinite loops (like hanging dev servers or blocking inputs).

### 2. Safety Gate (Confirmations)
*   **Interactive Prompts**: The first time the bash tool is called in a session, it *must* block execution and prompt the user for permission.
*   **Gating Rules**:
    *   **Always Ask**: The user can choose to approve the specific command, approve the command pattern forever, or deny it.
    *   **Persistent Approvals**: Approved commands are cached locally (e.g. in `.ak-coder/permissions.json`) so the agent doesn't prompt repeatedly for the exact same script (e.g. `bun test`).

### 3. Command Risk Classification
*   **Classification Levels**:
    *   **Safe (Read-Only)**: Commands that do not write or delete files, and have no side effects (e.g., `git diff`, `git status`, `cat package.json`, `pwd`, `ls`). If globally configured, safe commands can execute automatically without prompting the user.
    *   **Unsafe (Write/Mutate)**: Commands that install packages, compile code, remove directories, or run arbitrary scripts (e.g., `rm -rf`, `curl | bash`, `bun install`, `jest`). These *always* require explicit user verification.
*   **Pattern Matching**: Performs string parsing and regex-based checks to classify command risk prior to execution.
