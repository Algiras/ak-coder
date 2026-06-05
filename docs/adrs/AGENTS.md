# docs/adrs — Architecture Decision Records

## Purpose

ADRs capture significant architectural decisions — what was decided, why, and what alternatives were rejected. They are the authoritative source of truth for *why* the codebase is structured the way it is.

## Index

| ADR | Title | Status |
|-----|-------|--------|
| 01 | Hexagonal Architecture | Accepted |
| 02 | LLM Provider Abstraction | Accepted |
| 03 | Session Persistence | Accepted |
| 04 | Skills System | Accepted |
| 05 | Confirmation Policy | Accepted |
| 06 | Session Forking | Accepted |
| 07 | Plugin Output Schema | Accepted |
| 08 | Core Tools Registry | Accepted |

## ADR Format

Each ADR follows this structure:

```markdown
# ADR-NN: Title

## Status
Accepted | Superseded by ADR-XX | Deprecated

## Context
What problem prompted this decision?

## Decision
What was decided?

## Consequences
What are the trade-offs? What is now easier or harder?

## Alternatives Considered
What else was evaluated and why was it rejected?
```

## When to Write an ADR

Write an ADR when:
- Choosing between two or more viable technical approaches
- Accepting a known trade-off (e.g. coupling, performance, simplicity)
- Establishing a convention that future contributors must follow
- Reversing or superseding a previous decision

Do not write an ADR for implementation details that can change freely without affecting the architecture.
