# PRD 08: Planning Mode

## Overview
When agents execute large architectural changes, user confirmation is critical to prevent unwanted modifications. Planning Mode enables the agent to safely dry-run instructions and draft implementation plans before executing any code changes.

## Requirements

### 1. Plan Preset & Gating
- Introduce a `plan` confirmation policy preset that maps mutating actions (`write_file`, `patch_file`, `bash` commands) to `deny` or strict read-only execution.
- Restrict mutated tool exposures in the agent tool registry when Plan Mode is active.

### 2. System Prompt Directive
- Inject a clear instruction directive (e.g. `PLAN MODE ACTIVE: Propose plan changes...`) into the system prompt when the `--plan` flag is passed to the CLI.

### 3. Plan File Output
- Implement a hook in CLI and core (`onPlanProduced`) that automatically serializes the proposed plan markdown to a plans folder: `<workspaceRoot>/.ak-coder/plans/plan-<timestamp>-<hex4>.md`.
- Provide helper commands to list, read, and manage plan files.

## User Experience (UX)
- Running with `ak-coder --plan` initiates a planning session.
- Once a plan is produced, the CLI writes it to disk and reports its path to the user.
