# ADR 02: ReAct Loop Safety, Gating & Locks

## Context
Coding agents must have terminal execution and file writing tools to edit codebases. However, giving an LLM unstructured access to run mutating terminal commands (`rm -rf`, `npm install`) and overwrite source files blindly can lead to system damage, infinite loops, and token budget exhausts.

## Decision
We implemented several safety mechanisms directly in the `AgentCore` tool execution loop:
1. **Autonomous ReAct Loop**: The host executes tool calls iteratively in a loop, feeding outputs back as `tool` messages.
2. **Consecutive Loop Limit**: The loop terminates with a warning after a maximum of **25 consecutive tool calls** per user prompt to prevent runaways.
3. **Write-Only-After-Read Lock**: The agent maintains a list of files read during the session. If the LLM attempts to write or edit a file it has not read first, the tool execution throws an error, forcing a read first.
4. **Command Safety Gating**: Commands are classified as `safe` (e.g. `ls`, `git status`) or `unsafe` (e.g. `npm run build`, mutating calls). Unsafe commands prompt the user for confirmation and offer caching patterns.
5. **Unified Diff Confirmations**: File writes generate colored line-by-line unified diffs via `DiffEngine` and require user confirmation before committing changes.

## Consequences
* **Budget Safety**: Runaway infinite LLM tool-calling loops are halted automatically.
* **Code Integrity**: The agent cannot perform "blind writes" (overwriting file content without knowing what was there first), avoiding code corruption.
* **User Control**: Critical mutations (file writes, unsafe shell commands) are fully visible and gate-confirmed by the developer.
