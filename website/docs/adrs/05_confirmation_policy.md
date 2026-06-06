# ADR 05: Confirmation Policy — Five Presets and Plan Mode

## Context
The agent can perform irreversible or high-impact actions: writing files, running shell commands, or patching source code. Different usage contexts require different safety levels — a CI pipeline needs zero-friction automation, a cautious developer wants to approve every write, and a planning session should never mutate the filesystem at all. A single hardcoded policy would be too restrictive for automation and too permissive for interactive use.

## Decision
We model safety constraints as a **ConfirmationPolicy** with five named presets:
| Preset | Writes | Commands |
|---|---|---|
| `default` | prompt | safe-auto / unsafe-prompt |
| `yolo` | auto | auto |
| `confirm-writes` | always prompt | auto |
| `confirm-commands` | auto | always prompt |
| `plan` | deny | deny |

The `plan` preset is a hard backstop: mutating tool calls (`write_file`, `patch_file`, `execute_command`) return an immediate rejection without ever reaching the confirmation UI. This is enforced in `ConfirmationPolicy.check()` via a `mode === 'deny'` branch. Additionally, when plan mode is active the agent filters those three tools from the LLM's tool list and injects a `**PLAN MODE ACTIVE**` directive into the system prompt — two independent defense layers so the LLM never wastes calls on tools that will be denied.

Preserve screen space in interactive prompts by using the following details formatting:
* **Compact Unified Diffs**: The `DiffEngine` parses files and renders color differences grouped into compact hunks (showing changes plus up to 3 context lines, formatted with standard `@@` line headers) rather than rendering full file contexts.
* **Rich UI Previews**: The Ink REPL uses `@claude-code-kit/ui` helper components (`FileEditPermissionContent` and `BashPermissionContent`) to render clean, readable previews for file edits and shell executions.
* **Theming**: The REPL UI is wrapped in a `ThemeProvider` component utilizing dark theme configurations.

Presets are activated via the `--plan` / `--yolo` CLI flags at startup, or toggled mid-session with `/plan`, `/plan off` REPL commands.

## Consequences
* **Defense in depth for plan mode**: Even if the system prompt directive is ignored, the tool-list filter prevents the LLM from attempting the call; the policy deny is the final backstop.
* **Safe CI default**: `yolo` mode allows fully unattended runs while other presets protect interactive sessions.
* **Clean Interactive Prompts**: Compact unified diff hunks prevent the console screen buffer from overflowing during writes.
* **Visual Polish**: Native preview components render syntax-highlighted and structurally distinct boxes for diff verification.
* **Testable without UI**: All five presets are exercised in `confirmation.test.ts` against `MockTerminalIo` — no real terminal needed.
