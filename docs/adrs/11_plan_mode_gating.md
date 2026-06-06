# ADR 11: Plan Mode & Mutating Tool Gating

## Context
When developers review instructions, they often want to see a draft plan first before committing to files writes or bash command executions. If the agent automatically applies edits, it might introduce bugs or compile errors before the user has reviewed the design.

## Decision
We implemented a dedicated **Planning Mode** activated via the `--plan` flag, which restricts mutations and structures plan delivery.

### Implementation Details
1. **Confirmation Gating**:
   - The confirmation policy defines a `plan` preset where `writes = 'deny'` and `commands = 'deny'`.
   - Modifying tool calls (`write_file`, `patch_file`, `bash` command executions) are intercepted at the confirmation step and auto-denied, throwing an execution error to the ReAct loop.
2. **Registry Filtering**:
   - In planning mode, mutating tools are excluded from the registered tool list exposed to the LLM.
3. **Plan Capture & Serialization**:
   - `AgentCore` triggers an `onPlanProduced` hook when a plan response is generated.
   - The CLI adapter maps this hook to write a unique markdown file under `.ak-coder/plans/plan-<timestamp>-<hex4>.md`.

## Consequences
- **Pros**:
  - Code safety: guaranteed that no files on the host system are modified.
  - Clear user workflows: developers can review plans, edit them, and then proceed with execution.
- **Cons**:
  - The agent must be explicitly restarted or run without `--plan` to apply the plan, meaning two separate session runs.
