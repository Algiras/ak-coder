# ADR 06: Session Forking — Inclusive Turn Index and Branching Semantics

## Context
Developers often want to explore alternative approaches from a mid-conversation checkpoint without losing the original thread. A "fork" operation that copies history up to a given turn enables cheap experimentation: try option A in the fork, keep the original for option B, discard whichever fails. The key design question is how to identify the fork point and what "turn N" means in a flat message array.

## Decision
We implement `forkSession(turnIndex, newSessionId?)` on both `AgentCore` and the `SessionStore` port:
1. **Inclusive slice**: `history.slice(0, turnIndex + 1)` — the message at `turnIndex` is included in the fork. This means `turnIndex = 1` preserves the first user message and first assistant reply (indices 0 and 1).
2. **Auto-generated IDs**: If `newSessionId` is omitted, the fork is named `fork-<original>-<timestamp>` so forks are traceable to their parent.
3. **Port-level contract**: `SessionStore.forkSession` is declared in `ports.ts` so all storage backends (in-memory mock, file-based, future DB) must implement it identically.
4. **REPL access**: `/fork [index]` in the CLI REPL forks the active session; `/fork` without an index defaults to the last turn.
5. **Workspace-scoped storage** (since 0.1.8): Session files live under `~/.ak-coder/history/workspaces/<folder>-<hash>/` keyed by cwd at startup. `/history` and `/resume` only list sessions for the current workspace.

## Consequences
* **Non-destructive exploration**: The original session is never modified; forks are independent branches.
* **Index semantics require care**: Because the message array is flat (interleaved user/assistant/tool messages), `turnIndex` refers to a raw message index, not a semantic "conversation turn". Callers using `/fork` at the REPL pass the index of the assistant reply they want to branch from.
* **SessionStore implementations must support forkSession**: Older backends without this method will fail at compile time, enforcing the contract across all adapters.
