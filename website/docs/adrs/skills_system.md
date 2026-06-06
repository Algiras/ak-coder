# ADR 04: Skills System — SKILL.md Discovery and Injection

## Context
The agent needs a way to carry persistent, reusable instruction sets (coding conventions, domain-specific directives, workflow checklists) that survive across multiple sessions without polluting the main conversation history or requiring the user to re-paste them each time. File-based discovery is preferable over a database so skills can be version-controlled alongside the project.

## Decision
We implement a **file-based Skills System**:
1. **Discovery**: `AgentCore.loadSkills(root)` recursively walks the workspace and collects every `SKILL.md` file.
2. **Frontmatter parsing**: Each `SKILL.md` starts with a YAML frontmatter block (`--- name: ... description: ... ---`). The `name` and `description` fields are extracted; the remainder of the file is the instruction body.
3. **System prompt injection**: At the start of each `processMessage` turn, all loaded skill bodies are appended to the system prompt under an `Available Skills` section. This means skills influence every LLM call without consuming user/assistant turns.
4. **Hot reload**: Skills can be refreshed mid-session via `/skills reload`, on `/new`, or automatically after any write tool succeeds on a path ending in `SKILL.md`. `AgentCore.reloadSkills()` rescans the workspace and replaces in-memory skill definitions.
5. **Invocation**: `/skills:<name> [args]` sends an `Apply Skill "<name>"…` user message with the full skill body. Tab completion for skill names is provided by a slash-command extension registry (`slash-commands.ts`).

## Consequences
* **Reusable prompting**: Teams can commit project-specific skills to `.ak-coder/skills/` and all collaborators benefit automatically.
* **Live editing**: Agents can create or edit skills during a session; reload picks them up without restart.
* **System prompt growth**: Each loaded skill adds tokens to every LLM call. Overly broad skill directories can inflate costs; users should keep skills concise and targeted.
* **Testable**: Skills are plain text files — unit tests and evals can assert reload behavior and skill invocation (`check.skillInvoked`).
