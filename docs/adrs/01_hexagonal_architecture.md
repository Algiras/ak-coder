# ADR 01: Hexagonal Ports & Adapters Architecture

## Context
A major challenge in coding agents and CLI harnesses is maintaining portability, testability, and sandbox isolation. Code that depends directly on Node.js standard libraries (`fs`, `child_process`, `readline`) is hard to run in isolated WASM environments, mock for fast in-process tests, or execute inside browser terminals.

## Decision
We adopted **Hexagonal Architecture** (also known as Ports & Adapters):
1. **Ports**: All external system interaction is declared as pure TypeScript interfaces in `packages/core/src/ports.ts` (e.g. `FileSystem`, `TerminalIo`, `ProcessRunner`, `LLMService`, `Logger`).
2. **Adapters**: Implementations of these ports are written inside separate platform-specific environments (e.g. `apps/cli/src/adapters/` contains standard Node implementations, while `packages/core/src/mocks/` contains in-memory mocks for testing).
3. **Core Engine**: The `AgentCore` only references the ports interfaces. Dependencies are resolved via constructor parameter injection or a global `DependencyRegistry`.

## Consequences
* **Extremely Fast Testing**: We can run E2E scenarios, prompt compactions, safety gating, and tool calls in memory in less than 50ms without interacting with the real filesystem or executing real bash commands.
* **Sandbox Portability**: The core engine can be ported to run in a browser or WASM sandbox by simply writing browser-specific adapters for `FileSystem` and `TerminalIo`.
* **Decoupled Development**: Developers can work on CLI REPL interfaces or new plugin integrations without risking core agent execution regressions.
