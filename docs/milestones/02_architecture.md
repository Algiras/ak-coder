# Milestone 2: Hexagonal Ports & Mock Interfaces

## Objectives
Establish the core engine interfaces (Ports) in `packages/core` and implement mock versions of all services. This allows testing agent business logic decoupled from concrete terminal, filesystem, and API platforms.

## Deliverables
- [ ] Create `packages/core` directory and configure its `package.json`.
- [ ] Define the following Port interfaces in `packages/core/src/ports.ts`:
  *   `FileSystem`: Read/write/delete files, check file existence, list workspace files, verify gitignore checks.
  *   `TerminalIo`: Read prompt input, write text to stdout/stderr, stream responses, display interactive menus, handle tab-autocompletions.
  *   `ProcessRunner`: Spawn and manage shell commands.
  *   `LLMService`: Call LLMs for stream/non-stream chats, compute token usages.
  *   `SessionStore`: Save and reload JSONL conversation histories.
  *   `Logger`: Trace spans, structured log writes, and log rotation.
- [ ] Implement `DependencyRegistry` in `packages/core/src/registry.ts` to register and retrieve concrete/mock adapters.
- [ ] Build mock implementations of all Ports under `packages/core/src/mocks/`.
- [ ] Write a basic unit test verifying the `DependencyRegistry` and mock interfaces under `packages/core/tests/registry.test.ts`.

## Verification
- Run `bun test` in `packages/core` and assert that mock adapter registrations resolve successfully and tests pass.
