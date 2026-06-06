# Milestone 11: Semantic Search & Workspace Indexer

## Objectives
Establish a zero-dependency in-memory workspace search tool enabling natural language semantic queries.

## Deliverables
- [x] Implement vocabulary term cleaning, stop-word filtering, and TF-IDF calculation modules.
- [x] Implement `VectorStore` class to compute cosine similarity on term weight vectors.
- [x] Implement recursive workspace parser in `WorkspaceIndexer` ignoring file/folder match exclusions.
- [x] Implement and register `index_workspace` and `semantic_search` agent tools.
- [x] Write unit tests and integration evaluations verifying search retrieval accuracy.

## Verification
- Run `bun test packages/core/tests/semantic.test.ts`
- Run integration evals: `bun run packages/evals/run.ts semantic`
