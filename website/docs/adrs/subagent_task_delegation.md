# ADR 10: Nested Sub-agent Task Delegation

## Context
When performing complex multi-step tasks, a single agent loop can exhaust its context window or get stuck in repetitive reasoning loops. Spawning subprocesses or running external scripts is unreliable. We need a way for the agent to delegate sub-tasks to specialized sub-agents.

## Decision
We decided to support nested sub-agents by enabling `AgentCore` to spawn child `AgentCore` instances recursively.

### Implementation Details
1. **Creation**:
   - The tool context exposes `ctx.createChildAgent(sessionId)`.
   - The child agent is initialized with the same system ports (filesystem, LLM service, process runner) but receives a customized session ID and custom system prompt.
2. **Context Passing**:
   - The parent can specify a list of files (`filesToInclude`) which are explicitly added to the child's context store before starting.
3. **Depth Guard**:
   - The parent context tracks a `delegationDepth`.
   - Spawning is rejected with an error if the delegation depth exceeds 3, preventing runaway loops of sub-agents calling more sub-agents.

## Consequences
- **Pros**:
  - Code reusability: uses the exact same `AgentCore` logic and ReAct loop.
  - Context isolation: child agents have clean context windows with only the relevant files loaded.
  - Safe boundary limits: recursion depth prevents infinite token loops.
- **Cons**:
  - LLM calls run sequentially, increasing total latency when sub-agents are spawned.
  - Token consumption can increase rapidly since each sub-agent initializes its own prompt.
