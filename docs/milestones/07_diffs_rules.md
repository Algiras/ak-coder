# Milestone 7: Visual Diffs & AGENTS.md

## Objectives
Build terminal visual diffs for reviewing file write changes, and implement the project-level `AGENTS.md` parser.

## Deliverables
- [ ] Implement a unified diff engine in the CLI adapter that takes old file content and new file content and outputs a standard terminal-colorized diff.
- [ ] Intercept write and edit tool executions to display the visual diff and request user verification before saving to disk.
- [ ] Implement `AGENTS.md` parser that scans the workspace root for custom rules, instructions, or build commands, appending them to the active system prompt.

## Verification
- Test that attempting to write to a file outputs a colorized diff showing modifications.
- Test that placing custom instructions in `AGENTS.md` updates the model's system prompt appropriately.
