---
sidebar_position: 3
---

# Skills (Custom Slash Commands)

Any file named `SKILL.md` anywhere in the workspace is loaded as a custom slash command.

## Format

```markdown
---
name: my-skill
description: One-line description shown in /help
---

Full instructions go here. The agent receives these instructions
when you type /skills:my-skill, along with any arguments you typed after it.
```

## Example

Create `.ak-coder/skills/review/SKILL.md`:

```markdown
---
name: review
description: Review changed files for quality issues
---

Review all files changed since the last git commit. For each file:
1. Check for obvious bugs or logic errors
2. Check for missing error handling at system boundaries
3. Note any code that could be simplified without changing behavior

Be concise. Report issues as a bullet list per file.
```

Then use it:

```
/skills:review
/skills:review focus on error handling
```

Legacy form `/review` also works in the Ink REPL.

## Discovery and reload

| When | What happens |
|------|----------------|
| CLI startup | All `SKILL.md` files under cwd are scanned |
| `/skills reload` | Rescan workspace (pick up new or edited skills) |
| `/new` | New conversation; skills reloaded with session |
| Agent writes/edits a `SKILL.md` | Auto-reload after successful `write_file`, `patch_file`, or `str_replace` |

List loaded skills:

```
/skills
/help
```

Skill names and descriptions also appear in `/context`.

## Tab completion

In the Ink REPL, type `/` and press **Tab**:

- `/skills` → shows `/skills reload` plus every loaded `/skills:<name>`
- `/skills:` → narrows to skill names only

Completion is driven by the slash-command extension registry in `apps/cli/src/slash-commands.ts`. New extension prefixes can be registered without editing the base command map.

## Multiple SKILL.md files

Place them anywhere — project root, `.ak-coder/skills/`, `.cursor/skills/`, subdirectories. All are discovered on scan.

The `name` field in front-matter drives the slash command. If omitted, the parent folder name is used. `description` appears in `/help` and tab completion.

## Skills vs plugins

| | Skill | Plugin |
|---|-------|--------|
| Adds | Slash command (LLM instructions) | Executable MCP tool |
| File | `SKILL.md` | `plugin.json` + script |
| Reload | `/skills reload` or edit file | Restart CLI |

Skills do not add new tools — they tell the LLM how to behave when invoked.

See [ADR 04: Skills System](/docs/adrs/skills_system).
