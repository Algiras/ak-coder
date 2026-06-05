/**
 * In-memory vector store for semantic search.
 * Uses cosine similarity over float32 embedding vectors.
 */

export interface VectorChunk {
  /** Workspace-relative file path */
  filePath: string;
  /** 0-based start line of this chunk within the file */
  startLine: number;
  /** 0-based end line (inclusive) */
  endLine: number;
  /** The raw text content of this chunk */
  text: string;
  /** The embedding vector */
  embedding: number[];
}

export interface SearchResult {
  filePath: string;
  startLine: number;
  endLine: number;
  text: string;
  /** Cosine similarity score, 0–1 */
  score: number;
}

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

function magnitude(v: number[]): number {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
}

function cosineSimilarity(a: number[], b: number[]): number {
  const magA = magnitude(a);
  const magB = magnitude(b);
  if (magA === 0 || magB === 0) return 0;
  return dotProduct(a, b) / (magA * magB);
}

export class VectorStore {
  private chunks: VectorChunk[] = [];

  /** Insert or replace all chunks for a given file */
  upsertFile(filePath: string, newChunks: VectorChunk[]): void {
    this.chunks = this.chunks.filter(c => c.filePath !== filePath);
    this.chunks.push(...newChunks);
  }

  /** Remove all chunks for a given file */
  removeFile(filePath: string): void {
    this.chunks = this.chunks.filter(c => c.filePath !== filePath);
  }

  /** Return the total number of indexed chunks */
  size(): number {
    return this.chunks.length;
  }

  /** Return all unique indexed file paths */
  indexedFiles(): string[] {
    return [...new Set(this.chunks.map(c => c.filePath))];
  }

  /**
   * Find the top-k chunks most similar to the query embedding.
   * @param queryEmbedding - embedding of the search query
   * @param topK - number of results to return
   * @param minScore - minimum cosine similarity (0–1)
   */
  search(queryEmbedding: number[], topK = 5, minScore = 0.1): SearchResult[] {
    const scored = this.chunks
      .map(chunk => ({
        ...chunk,
        score: cosineSimilarity(queryEmbedding, chunk.embedding)
      }))
      .filter(r => r.score >= minScore)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, topK).map(({ embedding: _emb, ...rest }) => rest);
  }

  /** Clear the entire store */
  clear(): void {
    this.chunks = [];
  }
}
