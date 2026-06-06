# Milestone 13: Plan Mode & Safe Gating

## Objectives
Ensure developers can safely dry-run instructions and draft implementation plan files without risking host mutations.

## Deliverables
- [x] Implement the `plan` confirmation policy preset in core which automatically rejects file modification and command executions.
- [x] Add the `--plan` CLI flag in index.ts and map it to the plan policy.
- [x] Integrate `onPlanProduced` hook in AgentCore and CLI mapping to save proposals as timestamped plan files.
- [x] Create comprehensive plan file utilities (`writePlanFile`, `listPlans`, `readPlan`) in apps/cli.
- [x] Write unit tests verifying plan policy auto-denial and plan file generation.

## Verification
- Run `bun test apps/cli/tests/plan_file.test.ts`
- Run core plan test: `bun test packages/core/tests/evals.test.ts`
