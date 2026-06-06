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
when you type /my-skill, along with any arguments you typed after it.
```

## Example

Create `.ak-coder/skills/review.md`:

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
```

Legacy form `/review` also works in the Ink REPL.

## Multiple SKILL.md files

Place them anywhere — project root, `.ak-coder/skills/`, subdirectories. All are discovered at startup.

The `name` field in front-matter drives the slash command. `description` appears in `/help`.
