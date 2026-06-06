# ADR 04: Skills System — SKILL.md Discovery and Injection

## Context
The agent needs a way to carry persistent, reusable instruction sets (coding conventions, domain-specific directives, workflow checklists) that survive across multiple sessions without polluting the main conversation history or requiring the user to re-paste them each time. File-based discovery is preferable over a database so skills can be version-controlled alongside the project.

## Decision
We implement a **file-based Skills System**:
1. **Discovery**: `AgentCore.loadSkills(root)` recursively walks the given root directory and collects every `SKILL.md` file.
2. **Frontmatter parsing**: Each `SKILL.md` starts with a YAML frontmatter block (`--- name: ... description: ... ---`). The `name` and `description` fields are extracted; the remainder of the file is the instruction body.
3. **System prompt injection**: At the start of each `processMessage` turn, all loaded skill bodies are appended to the system prompt under a `## Active Skills` section. This means skills influence every LLM call without consuming user/assistant turns.
4. **No dynamic switching**: Skills are loaded once at session start. Hot-reloading mid-session is not supported; users must start a new session to pick up skill changes.

## Consequences
* **Reusable prompting**: Teams can commit project-specific skills (e.g. "always use TypeScript strict mode", "follow Conventional Commits") to `.ak-coder/skills/` and all collaborators benefit automatically.
* **System prompt growth**: Each loaded skill adds tokens to every LLM call. Overly broad skill directories can inflate costs; users should keep skills concise and targeted.
* **Testable**: Skills are plain text files — unit tests can pre-populate a `MockFileSystem` with skill content and assert the injected system prompt contains the expected directive.
