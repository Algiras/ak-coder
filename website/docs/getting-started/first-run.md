---
sidebar_position: 3
---

# First Run

## Starting the REPL

```bash
bunx @algiras/ak-coder
```

You'll see the Ink UI banner with model, workspace, and keyboard hints:

```
 ╭──────────────────────────────────────╮
 │  ak-coder  v0.1.0                    │
 │  model  gemma3:4b                    │
 │  cwd    my-project                   │
 ╰──────────────────────────────────────╯
  /help for commands · Shift+Tab cycles modes · Ctrl+R history
```

## Slash commands

| Command | Description |
|---------|-------------|
| `/help` | List commands and loaded skills |
| `/new` | Start a new conversation (clears history) |
| `/providers` | List or switch LLM providers |
| `/model` | Switch model (interactive picker when Ollama is available) |
| `/plan on` | Enable planning mode — no writes or commands |
| `/plan off` | Return to normal execution |
| `/plan list` | List saved plan files |
| `/plan show <file>` | Display a saved plan |
| `/agent <role> \| <task>` | Spawn a sub-agent for a focused task |
| `/history` | List saved sessions |
| `/resume` | Resume a previous session |
| `/fork` | Fork the current session at a turn |
| `/rewind` | Rewind conversation to an earlier turn |
| `/context` | Dump session, tools, skills, and system prompt |
| `/settings` | View or edit config keys |
| `/stats` | Token and latency summary |
| `/budget` | Lifetime and recent spend |
| `/diff` | Show unstaged git diff |
| `/ping` | Check LLM endpoint latency |
| `/exit` | Exit the REPL |

Skills appear in `/help` and are invoked as `/skills:<name>` (e.g. `/skills:review`). A legacy `/skillname` form also works.

## Your first conversation

```
> Read the files in src/ and summarize what this project does
```

The agent will call `list_directory` and `read_file`, then summarize. Read-only tools like these can run [in parallel](/docs/tools/annotations) when the LLM requests several at once.

## Confirmation policy

By default ak-coder prompts before file writes and unsafe shell commands. Safe read-only commands (`ls`, `git status`, etc.) run automatically.

| Action | How |
|--------|-----|
| Plan mode (no mutations) | `/plan on` or **Shift+Tab** until mode shows `plan`, or start with `ak-coder --plan` |
| Normal mode (prompt before writes) | `/plan off` or **Shift+Tab** until mode shows `default` |
| Approve a single action | Use the permission prompt in the UI |
| Approve all similar this session | Choose "approve all" in the write or bash confirmation dialog |

The core engine supports additional presets (`yolo`, `confirm-writes`, `confirm-commands`) for programmatic use and evals — see [ADR 05: Confirmation Policy](/docs/adrs/confirmation_policy).

## Working with your codebase

Run ak-coder from your project root. It uses the current directory as the workspace — all file tools operate relative to it.

```bash
cd ~/my-project
bunx @algiras/ak-coder
> Add TypeScript strict mode to tsconfig.json
```

Project-level overrides can live in `.ak-coder/config.json` — see [Configuration](/docs/getting-started/configuration).

## One-shot and piping modes

```bash
# Single prompt argument
bunx @algiras/ak-coder "Summarize this repo"

# Pipe context on stdin
cat README.md | bunx @algiras/ak-coder "Summarize this document"
```
