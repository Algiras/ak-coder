/**
 * Workspace indexer: reads files, splits them into overlapping chunks,
 * and computes lightweight TF-IDF bag-of-words embeddings.
 *
 * No external dependencies or API keys are needed.  The vector
 * dimensionality equals the size of the vocabulary observed across
 * all indexed documents.
 */

import { FileSystem } from './ports';
import { VectorChunk, VectorStore } from './vector-store';

export interface IndexerOptions {
  /** Number of lines per chunk (default 30) */
  chunkLines?: number;
  /** Number of overlapping lines between consecutive chunks (default 5) */
  overlapLines?: number;
  /** File extensions to index, e.g. ['.ts', '.md'] (default: common text/code extensions) */
  extensions?: string[];
  /** Paths (substrings) to ignore, e.g. ['node_modules', '.git'] */
  ignorePatterns?: string[];
}

const DEFAULT_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.md', '.txt', '.yaml', '.yml',
  '.py', '.go', '.rs', '.sh', '.env',
];

const DEFAULT_IGNORE = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage'];

/** Tokenise a string into lowercase words (letters + digits only) */
function tokenise(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** Build a term-frequency map for a list of tokens */
function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  return tf;
}

export class WorkspaceIndexer {
  private vocab = new Map<string, number>(); // term → column index
  private store: VectorStore;
  private opts: Required<IndexerOptions>;

  constructor(store: VectorStore, opts: IndexerOptions = {}) {
    this.store = store;
    this.opts = {
      chunkLines: opts.chunkLines ?? 30,
      overlapLines: opts.overlapLines ?? 5,
      extensions: opts.extensions ?? DEFAULT_EXTENSIONS,
      ignorePatterns: opts.ignorePatterns ?? DEFAULT_IGNORE,
    };
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Index all eligible files under `workspaceRoot`.
   * Rebuilds the vocabulary and re-embeds every chunk.
   */
  async indexWorkspace(fs: FileSystem, workspaceRoot: string): Promise<void> {
    this.vocab.clear();

    const allFiles = await fs.listFiles(workspaceRoot);
    const eligible = allFiles.filter(f => this.isEligible(f));

    // First pass: gather all chunks and build vocabulary
    const fileChunks: { filePath: string; chunks: { start: number; end: number; text: string; tf: Map<string, number> }[] }[] = [];

    for (const file of eligible) {
      try {
        const content = await fs.readFile(file);
        const chunks = this.chunkFile(file, content);
        for (const c of chunks) {
          for (const term of c.tf.keys()) {
            if (!this.vocab.has(term)) {
              this.vocab.set(term, this.vocab.size);
            }
          }
        }
        fileChunks.push({ filePath: file, chunks });
      } catch {
        // skip unreadable files
      }
    }

    // Also gather and build vocabulary for existing history chunks in the store
    const historyChunks = this.store.getAllChunks().filter(c => c.filePath.startsWith('__history__/'));
    const historyChunksWithTf = historyChunks.map(hc => {
      const tf = termFrequency(tokenise(hc.text));
      for (const term of tf.keys()) {
        if (!this.vocab.has(term)) {
          this.vocab.set(term, this.vocab.size);
        }
      }
      return { chunk: hc, tf };
    });

    // Second pass: embed and store
    const dim = this.vocab.size;
    for (const { filePath, chunks } of fileChunks) {
      const vectorChunks: VectorChunk[] = chunks.map(c => ({
        filePath,
        startLine: c.start,
        endLine: c.end,
        text: c.text,
        embedding: this.embed(c.tf, dim),
      }));
      this.store.upsertFile(filePath, vectorChunks);
    }

    // Re-embed and store history chunks
    for (const { chunk, tf } of historyChunksWithTf) {
      const reEmbedded: VectorChunk = {
        ...chunk,
        embedding: this.embed(tf, dim),
      };
      this.store.upsertFile(chunk.filePath, [reEmbedded]);
    }
  }

  /**
   * (Re-)index a single file — useful for incremental updates.
   */
  async indexFile(fs: FileSystem, filePath: string): Promise<void> {
    const content = await fs.readFile(filePath);
    const rawChunks = this.chunkFile(filePath, content);

    // Grow vocabulary with any new terms
    for (const c of rawChunks) {
      for (const term of c.tf.keys()) {
        if (!this.vocab.has(term)) {
          this.vocab.set(term, this.vocab.size);
        }
      }
    }

    const dim = this.vocab.size;
    const vectorChunks: VectorChunk[] = rawChunks.map(c => ({
      filePath,
      startLine: c.start,
      endLine: c.end,
      text: c.text,
      embedding: this.embed(c.tf, dim),
    }));
    this.store.upsertFile(filePath, vectorChunks);
  }

  /**
   * Index a compacted conversation history summary.
   */
  indexSummary(summaryText: string, sessionId: string): void {
    const filePath = `__history__/${sessionId}/summary.txt`;
    const tokens = tokenise(summaryText);
    const tf = termFrequency(tokens);

    // Grow vocabulary with any new terms
    for (const term of tf.keys()) {
      if (!this.vocab.has(term)) {
        this.vocab.set(term, this.vocab.size);
      }
    }

    const dim = this.vocab.size;
    const chunk: VectorChunk = {
      filePath,
      startLine: 0,
      endLine: summaryText.split('\n').length - 1,
      text: summaryText,
      embedding: this.embed(tf, dim),
    };

    this.store.upsertFile(filePath, [chunk]);
  }

  /**
   * Embed a raw query string into a vector for similarity search.
   * Must be called after at least one indexWorkspace/indexFile call
   * so that the vocabulary exists.
   */
  embedQuery(query: string): number[] {
    const tokens = tokenise(query);
    const tf = termFrequency(tokens);
    return this.embed(tf, this.vocab.size);
  }

  vocabSize(): number {
    return this.vocab.size;
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private isEligible(filePath: string): boolean {
    for (const pat of this.opts.ignorePatterns) {
      if (filePath.includes(pat)) return false;
    }
    const lower = filePath.toLowerCase();
    return this.opts.extensions.some(ext => lower.endsWith(ext));
  }

  private chunkFile(
    _filePath: string,
    content: string
  ): { start: number; end: number; text: string; tf: Map<string, number> }[] {
    const lines = content.split('\n');
    const chunks: { start: number; end: number; text: string; tf: Map<string, number> }[] = [];
    const step = Math.max(1, this.opts.chunkLines - this.opts.overlapLines);

    for (let start = 0; start < lines.length; start += step) {
      const end = Math.min(start + this.opts.chunkLines - 1, lines.length - 1);
      const text = lines.slice(start, end + 1).join('\n');
      const tf = termFrequency(tokenise(text));
      chunks.push({ start, end, text, tf });
      if (end >= lines.length - 1) break;
    }

    return chunks;
  }

  private embed(tf: Map<string, number>, dim: number): number[] {
    const vec = new Array<number>(dim).fill(0);
    for (const [term, freq] of tf.entries()) {
      const idx = this.vocab.get(term);
      if (idx !== undefined && idx < dim) {
        vec[idx] = freq;
      }
    }
    return vec;
  }
}
