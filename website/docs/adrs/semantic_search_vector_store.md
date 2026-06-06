# ADR 09: In-Memory TF-IDF Vector Store & Indexer

## Context
Standard agent search relies on exact keyword matching (via `grep` or `glob`), which struggles with synonyms or conceptual queries. We need a semantic lookup feature. However, introducing an external vector database (like Chromadb or Pinecone) adds complex dependency requirements, installation overhead, and slows down local execution.

## Decision
We decided to implement a pure TypeScript in-memory vector store based on TF-IDF (Term Frequency-Inverse Document Frequency) calculations.

### Implementation Details
1. **WorkspaceIndexer**:
   - Recursively reads files matching extensions `.ts`, `.tsx`, `.js`, `.json`, `.md`.
   - Chunks files into small text blocks.
   - Cleans tokens (lowercase, alphanumeric filtering, basic stop-word removal).
2. **VectorStore**:
   - Computes TF-IDF matrices on indexing.
   - Computes cosine similarity of the query vector against all document chunk vectors.
   - Returns top-K results sorted by score, filtered by a minimum score threshold.

## Consequences
- **Pros**:
  - Zero external dependencies. Starts instantly and consumes minimal memory.
  - Very fast searches for typical workspace directory sizes (under 10,000 chunks).
  - Easy to unit test and mock.
- **Cons**:
  - Not suitable for huge codebases (e.g. monorepos with hundreds of thousands of files), where term frequency matrix allocations can exceed Node.js heap limits.
  - TF-IDF uses lexical overlap rather than dense embeddings (neural semantic search), so conceptual matching is limited to shared vocabularies.
