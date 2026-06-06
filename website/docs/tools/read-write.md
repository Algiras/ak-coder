---
sidebar_position: 2
---

# File Tools

## read_file

Reads a file and returns its content. The agent **must** call `read_file` before `str_replace` or `patch_file` — this prevents blind edits.

**Parameters:**
- `path` (string) — absolute or workspace-relative path

## write_file

Writes content to a file. Creates parent directories if needed. Shows a colored diff before writing (unless confirmation policy is `yolo`).

**Parameters:**
- `path` (string) — file path
- `content` (string) — full file content

## str_replace

Replaces an exact string in a file. Requires the file to have been read first in the current session.

**Parameters:**
- `path` (string) — file path
- `old_string` (string) — exact text to find (must be unique in the file)
- `new_string` (string) — replacement text

## patch_file

Applies a unified diff patch to a file. Requires the file to have been read first.

**Parameters:**
- `path` (string) — file path
- `patch` (string) — unified diff format

## list_directory

Lists files and directories at a path. Respects `.akcoderignore` and `.gitignore`.

**Parameters:**
- `path` (string) — directory path (defaults to workspace root)
