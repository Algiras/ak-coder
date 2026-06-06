---
sidebar_position: 3
---

# First Run

## Starting the REPL

```bash
bunx @algiras/ak-coder
```

You'll see:

```
AKCoder — your terminal AI assistant
Provider: ollama (gemma3:4b)
Type /help for commands, Ctrl+C to exit
>
```

## Built-in slash commands

| Command | Description |
|---------|-------------|
| `/help` | List all commands |
| `/providers` | Switch provider |
| `/plan list` | List saved plans |
| `/plan new` | Start planning mode |
| `/history` | Show session history |
| `/clear` | Clear session context |
| `/exit` | Exit the REPL |

## Your first conversation

```
> Read the files in src/ and summarize what this project does
```

The agent will call `list_directory` and `read_file` tools, then summarize.

## Confirmation policy

By default ak-coder asks before writing files or running commands. You can pre-approve:

```
> /yolo      — auto-approve everything this session
> /confirm   — go back to asking (default)
> /plan      — planning mode: no writes allowed
```

## Working with your codebase

Run ak-coder from your project root. It uses the current directory as the workspace — all file tools operate relative to it.

```bash
cd ~/my-project
bunx @algiras/ak-coder
> Add TypeScript strict mode to tsconfig.json
```
