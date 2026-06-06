---
sidebar_position: 2
---

# File Tools

Tool annotations are documented in [Tool Annotations](/docs/tools/annotations). Summary below each tool.

## read_file

Reads a file and returns its content.

**Annotations:** read-only · idempotent

**Parameters:**
- `path` (string, required) — workspace-relative path

The agent **must** call `read_file` before overwriting an existing file with `write_file`, `str_replace`, or `patch_file`. Creating a **new** file with `write_file` does not require a prior read. After a successful write, the file is marked as read for the rest of the session.

---

## write_file

Writes complete new content to a file. Creates parent directories if needed.

**Annotations:** destructive

**Parameters:**
- `path` (string, required) — workspace-relative path
- `content` (string, required) — full file content to write

Shows a colored unified diff before overwriting. **New files** are written immediately with no prompt. Overwriting an existing file requires `read_file` first and shows a diff for approval.

Plugins can intercept writes via `beforeWriteFile` / `afterWriteFile` hooks to transform content or cancel the write.

---

## str_replace

Replaces an exact string in a file. Simpler than `patch_file` for targeted single-location edits.

**Annotations:** destructive

**Parameters:**
- `path` (string, required) — workspace-relative path
- `old_string` (string, required) — exact text to replace (must appear exactly once in the file)
- `new_string` (string, required) — replacement text

The file must have been read first. If `old_string` matches more than once, the operation is rejected to prevent ambiguous edits.

---

## patch_file

Applies a list of search-and-replace patches to a file sequentially. Preferred over `write_file` for editing existing files — only the changed blocks need to be specified.

**Annotations:** destructive

**Parameters:**
- `path` (string, required) — workspace-relative path
- `patches` (array, required) — list of patch objects:
  - `find` (string) — exact block of code to find (including whitespace and indentation)
  - `replace` (string) — replacement block

Patches are applied in order. Each `find` must match exactly. The file must have been read first.

---

## list_directory

Lists files and directories at a path.

**Annotations:** read-only · idempotent

**Parameters:**
- `path` (string, required) — directory path (pass `.` for workspace root)

Respects `.akcoderignore` and `.gitignore` patterns.
