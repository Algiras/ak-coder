# apps/cli/src/adapters — Adapter conventions

## Purpose

Concrete Node.js implementations of the port interfaces defined in `packages/core/src/ports.ts`. Each adapter lives in its own file and has a single responsibility.

## Files

| File | Port | Notes |
|------|------|-------|
| `filesystem.ts` | `FileSystem` | Uses Node `fs/promises`; `listFiles` recurses respecting `.akcoderignore` |
| `terminal.ts` | `TerminalIo` | `readline`-based interactive I/O; `noReadline=true` for `--stdio` mode |
| `process.ts` | `ProcessRunner` | Spawns child processes via `child_process.spawn`; captures stdout/stderr |
| `stdio.ts` | — | `StdioJsonRpcAdapter` — MCP server over stdin/stdout for IDE integration |

## Key Design Notes

- **`NodeTerminalIo`** — pass `noReadline = true` when `--stdio` mode is active; `StdioJsonRpcAdapter` creates its own readline on stdin and the two must not conflict.
- **`NodeFileSystem.listFiles`** — returns absolute paths; skips `node_modules`, `.git`, and patterns from `.akcoderignore`.
- **`NodeProcessRunner`** — always runs with `cwd: workspaceRoot`; timeout defaults to 30 seconds.
- **Tab completion** in `NodeTerminalIo` lists known slash commands — update the `completions` array in the constructor when adding new REPL commands.
- **`StdioJsonRpcAdapter`** — implements a subset of the MCP protocol. Add new JSON-RPC methods here if IDE clients need additional capabilities.

## Adding a New Adapter

1. Create the file as `adapters/<name>.ts`.
2. Import the port interface from `@ak-coder/core`.
3. Implement all methods; keep the constructor simple (no side effects).
4. Wire it up in `apps/cli/src/index.ts` where the other adapters are created.
