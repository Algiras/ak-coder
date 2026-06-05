# Milestone 3: Terminal REPL & Command UX

## Objectives
Implement the interactive terminal REPL shell using `apps/cli`. Implement rich keyboard controls, autocomplete features, slash commands, markdown formatting, and interrupt boundaries.

## Deliverables
- [ ] Create `apps/cli` directory and configure its `package.json` with imports from `@ak-coder/core`.
- [ ] Implement `apps/cli/src/adapters/terminal.ts` implementing `TerminalIo`.
  *   Use Node's `readline` or standard terminal libraries to handle raw input mode.
  *   Implement left/right arrow cursor moves and up/down command history browsing.
  *   Implement tab-completion matching files and slash commands.
- [ ] Implement a popup selection menu triggered when typing `/` in the prompt.
- [ ] Implement terminal formatting:
  *   Markdown parser styling headers, bullets, and codes.
  *   Syntax highlighting of code blocks based on language type.
- [ ] Integrate `Ctrl+C` handler to interrupt active output streams cleanly without terminating the shell.

## Verification
- Launch the CLI using `bun run dev` (or run a CLI binary) and manually verify:
  *   Cursor positioning via arrows.
  *   Tab completion of paths.
  *   `/` showing slash command list.
  *   `Ctrl+C` halts rendering cleanly.
