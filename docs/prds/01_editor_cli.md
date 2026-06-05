# PRD-01: Terminal CLI Client & Editor UX

## Overview
The CLI client (`apps/cli`) is the interactive terminal interface for the `ak-coder` agent. It provides a rich terminal environment (TUI) for developers to interact with the agent, manage files, run commands, and execute coding workflows.

## Requirements

### 1. Interactive REPL Prompt
*   **Arrow Controls**: Users can move the cursor left/right in the input line, and browse previous prompt history using up/down arrow keys.
*   **Tab Completion**: Autocompletes folder paths, filenames, slash commands, and registered agent skills when pressing the Tab key.
*   **Interrupt Handling**: Pressing `Ctrl+C` cancels current streaming LLM output or active subprocess without terminating the REPL. Pressing `Ctrl+D` or typing `/exit` terminates the REPL gracefully.
*   **Slash Command Menu**: Typing `/` pops up a selectable list of commands with brief descriptions.

### 2. Output Formatting
*   **Markdown Rendering**: Renders headers, lists, code blocks, bold/italic text, and tables cleanly using terminal styles.
*   **Syntax Highlighting**: Code blocks in model outputs are syntax-highlighted depending on the detected programming language.
*   **Live Streaming**: Text is streamed token-by-token directly to stdout in real time.

### 3. Session Persistence & Branching (Forking)
*   **Local History**: Conversations are logged as JSONL files under `~/.ak-coder/history/` with unique session IDs (timestamps + random suffix).
*   **Resume Session**: Running `ak-coder resume <session_id>` loads past history and restarts the prompt from the last state.
*   **Fork-to-Fork Branching**: Running `/fork <turn_index>` duplicates the active session up to the specified turn index and branches into a new session. This allows developers to test alternative implementation paths.

### 4. Slash Commands
*   `/help` - Lists all available slash commands and shortcuts.
*   `/ping` - Performs a system latency test to the LLM endpoint and diagnostic check.
*   `/context` - Inspects current context: active files, system prompts, token usage, and compaction history.
*   `/history` - Lists all past sessions with IDs, titles, and timestamps.
*   `/resume <session_id>` - Resumes a session.
*   `/fork <turn_index>` - Forks the current session.
*   `/exit` - Gracefully exits the shell.
