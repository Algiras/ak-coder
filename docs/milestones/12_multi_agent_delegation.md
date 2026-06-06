# Milestone 12: Sub-agent Task Delegation

## Objectives
Enable complex work to be decomposed and handed off to specialized child agent instances recursively.

## Deliverables
- [x] Add `createChildAgent()` constructor helper on core/agent context.
- [x] Implement the `delegate_task` tool to spawn child agents with custom system prompt roles and contexts.
- [x] Add recursion depth tracking and enforce a limit of 3 nesting layers.
- [x] Write unit tests verifying sub-agent context seeding and delegation limits.
- [x] Create LLM-as-judge evaluation check for sub-agent spawning.

## Verification
- Run `bun test packages/core/tests/subagent.test.ts`
- Run integration evals: `bun run packages/evals/run.ts delegate`
