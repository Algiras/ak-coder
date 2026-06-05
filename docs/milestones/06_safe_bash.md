# Milestone 6: Safe Bash Execution

## Objectives
Equip the agent with bash command capabilities while enforcing safety confirmation gates and caching authorized permissions.

## Deliverables
- [ ] Implement `ProcessRunner` adapter using Node's `child_process` / Bun subprocess APIs.
- [ ] Build command risk classifier separating safe (read-only) commands from unsafe (mutating/executing) commands.
- [ ] Implement safety verification gate:
  *   Prompt user before running any bash command on first use or if classified as unsafe.
  *   Allow option to authorize a specific command, authorize its pattern permanently, or block it.
- [ ] Implement local permission cache storing authorized patterns (e.g. in `.ak-coder/permissions.json`).

## Verification
- Test that safe commands (like `git status`) run automatically if configured, while mutating commands (like `rm`) trigger interactive prompt gates.
- Verify cached permissions prevent duplicate prompts for the same command pattern.
