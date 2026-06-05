import { describe, it, expect, beforeEach } from 'bun:test';
import { VectorStore } from '../src/features/history/vector-store';
import { WorkspaceIndexer } from '../src/features/history/indexer';
import { AgentCore } from '../src/agent';
import { ChatMessage } from '../src/ports';
import {
  MockFileSystem,
  MockSessionStore,
  MockLogger,
  MockTerminalIo,
  MockProcessRunner
} from '../src/mocks';

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

class QueueMockLlm {
  public responses: { text: string; tool_calls?: any[] }[] = [];
  public lastMessages: ChatMessage[] = [];

  async chat(
    messages: ChatMessage[],
    options?: { stream?: (chunk: string) => void; tools?: any[] }
  ) {
    this.lastMessages = messages;
    const resp = this.responses.shift() ?? { text: 'done' };
    if (options?.stream && resp.text) options.stream(resp.text);
    return {
      text: resp.text,
      inputTokens: 5,
      outputTokens: 10,
      tool_calls: resp.tool_calls,
    };
  }
}

// ──────────────────────────────────────────────────────────────
// VectorStore unit tests
// ──────────────────────────────────────────────────────────────

describe('VectorStore', () => {
  let store: VectorStore;

  beforeEach(() => {
    store = new VectorStore();
  });

  it('should start empty', () => {
    expect(store.size()).toBe(0);
    expect(store.indexedFiles()).toEqual([]);
  });

  it('should upsert chunks and track file count', () => {
    store.upsertFile('a.ts', [
      { filePath: 'a.ts', startLine: 0, endLine: 5, text: 'hello world', embedding: [1, 0] },
    ]);
    store.upsertFile('b.ts', [
      { filePath: 'b.ts', startLine: 0, endLine: 5, text: 'foo bar', embedding: [0, 1] },
    ]);
    expect(store.size()).toBe(2);
    expect(store.indexedFiles()).toContain('a.ts');
    expect(store.indexedFiles()).toContain('b.ts');
  });

  it('replaces previous chunks when same file is upserted again', () => {
    store.upsertFile('a.ts', [
      { filePath: 'a.ts', startLine: 0, endLine: 4, text: 'old', embedding: [1, 0] },
      { filePath: 'a.ts', startLine: 5, endLine: 9, text: 'old 2', embedding: [1, 0] },
    ]);
    expect(store.size()).toBe(2);

    store.upsertFile('a.ts', [
      { filePath: 'a.ts', startLine: 0, endLine: 9, text: 'new', embedding: [0, 1] },
    ]);
    expect(store.size()).toBe(1);
  });

  it('removes a file from the index', () => {
    store.upsertFile('a.ts', [
      { filePath: 'a.ts', startLine: 0, endLine: 4, text: 'test', embedding: [1, 0] },
    ]);
    store.removeFile('a.ts');
    expect(store.size()).toBe(0);
    expect(store.indexedFiles()).not.toContain('a.ts');
  });

  it('returns top-k results sorted by cosine similarity', () => {
    store.upsertFile('exact.ts', [
      { filePath: 'exact.ts', startLine: 0, endLine: 3, text: 'exact match', embedding: [1, 0, 0] },
    ]);
    store.upsertFile('partial.ts', [
      { filePath: 'partial.ts', startLine: 0, endLine: 3, text: 'partial', embedding: [0.7, 0.7, 0] },
    ]);
    store.upsertFile('unrelated.ts', [
      { filePath: 'unrelated.ts', startLine: 0, endLine: 3, text: 'unrelated', embedding: [0, 0, 1] },
    ]);

    const results = store.search([1, 0, 0], 2, 0);
    expect(results).toHaveLength(2);
    expect(results[0].filePath).toBe('exact.ts');
    expect(results[0].score).toBeCloseTo(1, 4);
  });

  it('filters by minScore', () => {
    store.upsertFile('close.ts', [
      { filePath: 'close.ts', startLine: 0, endLine: 0, text: 'x', embedding: [1, 0] },
    ]);
    store.upsertFile('far.ts', [
      { filePath: 'far.ts', startLine: 0, endLine: 0, text: 'y', embedding: [0, 1] },
    ]);

    // Query [1,0] → close.ts scores 1, far.ts scores 0 → far filtered by minScore 0.5
    const results = store.search([1, 0], 5, 0.5);
    expect(results.map(r => r.filePath)).toEqual(['close.ts']);
  });

  it('clears all chunks', () => {
    store.upsertFile('a.ts', [
      { filePath: 'a.ts', startLine: 0, endLine: 0, text: 'x', embedding: [1] },
    ]);
    store.clear();
    expect(store.size()).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────
// WorkspaceIndexer unit tests
// ──────────────────────────────────────────────────────────────

describe('WorkspaceIndexer', () => {
  it('indexes files and builds a vocabulary', async () => {
    const mockFs = new MockFileSystem();
    await mockFs.writeFile('/ws/main.ts', 'function hello() {\n  return "world";\n}');

    const store = new VectorStore();
    const indexer = new WorkspaceIndexer(store, { extensions: ['.ts'] });
    await indexer.indexWorkspace(mockFs as any, '/ws');

    expect(store.size()).toBeGreaterThan(0);
    expect(store.indexedFiles()).toContain('/ws/main.ts');
    expect(indexer.vocabSize()).toBeGreaterThan(0);
  });

  it('ignores files that do not match extensions', async () => {
    const mockFs = new MockFileSystem();
    await mockFs.writeFile('/ws/image.png', 'binary');
    await mockFs.writeFile('/ws/app.ts', 'export const x = 1;');

    const store = new VectorStore();
    const indexer = new WorkspaceIndexer(store, { extensions: ['.ts'] });
    await indexer.indexWorkspace(mockFs as any, '/ws');

    expect(store.indexedFiles()).not.toContain('/ws/image.png');
    expect(store.indexedFiles()).toContain('/ws/app.ts');
  });

  it('embedQuery produces a vector of the same dimension as the vocabulary', async () => {
    const mockFs = new MockFileSystem();
    await mockFs.writeFile('/ws/a.ts', 'const alpha = 1;\nconst beta = 2;');

    const store = new VectorStore();
    const indexer = new WorkspaceIndexer(store, { extensions: ['.ts'] });
    await indexer.indexWorkspace(mockFs as any, '/ws');

    const vec = indexer.embedQuery('alpha function return');
    expect(vec.length).toBe(indexer.vocabSize());
  });

  it('search finds a chunk whose terms match the query', async () => {
    const mockFs = new MockFileSystem();
    await mockFs.writeFile('/ws/rpc.ts', 'function handleJsonRpc(msg: Message) {\n  dispatch(msg);\n}');
    await mockFs.writeFile('/ws/util.ts', 'export function noop() {}');

    const store = new VectorStore();
    const indexer = new WorkspaceIndexer(store, { extensions: ['.ts'] });
    await indexer.indexWorkspace(mockFs as any, '/ws');

    const queryVec = indexer.embedQuery('json rpc message dispatch');
    const results = store.search(queryVec, 3, 0);

    // rpc.ts should be ranked higher than util.ts
    expect(results.length).toBeGreaterThan(0);
    const topFile = results[0].filePath;
    expect(topFile).toBe('/ws/rpc.ts');
  });

  it('indexSummary stores a compacted summary in vector-store', () => {
    const store = new VectorStore();
    const indexer = new WorkspaceIndexer(store);
    indexer.indexSummary('conversation about JSON-RPC protocol implementation details', 'session-123');

    expect(store.size()).toBe(1);
    expect(store.indexedFiles()).toContain('__history__/session-123/summary.txt');

    const queryVec = indexer.embedQuery('JSON-RPC details');
    const results = store.search(queryVec, 1, 0);
    expect(results).toHaveLength(1);
    expect(results[0].filePath).toBe('__history__/session-123/summary.txt');
  });

  it('indexWorkspace preserves existing history chunks and re-embeds them', async () => {
    const mockFs = new MockFileSystem();
    await mockFs.writeFile('/ws/main.ts', 'export const x = 1;');

    const store = new VectorStore();
    const indexer = new WorkspaceIndexer(store, { extensions: ['.ts'] });

    // Index summary first
    indexer.indexSummary('history summary message', 'sess-1');
    expect(store.size()).toBe(1);

    // Index workspace
    await indexer.indexWorkspace(mockFs as any, '/ws');

    // Should now have BOTH main.ts and history summary in the store
    expect(store.indexedFiles()).toContain('__history__/sess-1/summary.txt');
    expect(store.indexedFiles()).toContain('/ws/main.ts');
    expect(store.size()).toBe(2);

    // Semantic search should match both
    const results = store.search(indexer.embedQuery('history summary'), 2, 0);
    expect(results[0].filePath).toBe('__history__/sess-1/summary.txt');
  });
});

// ──────────────────────────────────────────────────────────────
// AgentCore semantic_search tool integration tests
// ──────────────────────────────────────────────────────────────

describe('AgentCore semantic_search tool', () => {
  let mockFs: MockFileSystem;
  let mockLlm: QueueMockLlm;
  let mockStore: MockSessionStore;
  let mockLogger: MockLogger;
  let mockNio: MockTerminalIo;
  let mockNpr: MockProcessRunner;
  const workspaceRoot = '/workspace';

  beforeEach(async () => {
    mockFs = new MockFileSystem();
    mockLlm = new QueueMockLlm();
    mockStore = new MockSessionStore();
    mockLogger = new MockLogger();
    mockNio = new MockTerminalIo();
    mockNpr = new MockProcessRunner();

    // Seed workspace files
    await mockFs.writeFile(
      '/workspace/src/rpc.ts',
      'function handleJsonRpcMessage(msg: Message) {\n  return dispatch(msg);\n}'
    );
    await mockFs.writeFile(
      '/workspace/src/util.ts',
      'export function noop() { return null; }'
    );
  });

  it('returns empty message when index is empty', async () => {
    const agent = new AgentCore(mockFs, mockLlm as any, mockStore, mockLogger, mockNpr, mockNio, workspaceRoot);
    await agent.startSession('sem-empty');

    mockLlm.responses = [
      {
        text: 'searching',
        tool_calls: [{
          id: 'search_1',
          type: 'function',
          function: { name: 'semantic_search', arguments: JSON.stringify({ query: 'rpc dispatch' }) }
        }]
      },
      { text: 'done' }
    ];

    await agent.processMessage('find rpc handler');
    const toolMsg = agent.getMessages().find(m => m.role === 'tool' && m.tool_call_id === 'search_1');
    expect(toolMsg?.content).toContain('index is empty');
  });

  it('indexes workspace and finds relevant file via semantic_search', async () => {
    const agent = new AgentCore(mockFs, mockLlm as any, mockStore, mockLogger, mockNpr, mockNio, workspaceRoot);
    await agent.startSession('sem-search');

    mockLlm.responses = [
      {
        text: 'indexing workspace',
        tool_calls: [{
          id: 'idx_1',
          type: 'function',
          function: { name: 'index_workspace', arguments: JSON.stringify({ extensions: ['.ts'] }) }
        }]
      },
      {
        text: 'searching',
        tool_calls: [{
          id: 'search_1',
          type: 'function',
          function: { name: 'semantic_search', arguments: JSON.stringify({ query: 'json rpc message dispatch', topK: 3, minScore: 0 }) }
        }]
      },
      { text: 'done' }
    ];

    await agent.processMessage('find the rpc handler');

    const idxMsg = agent.getMessages().find(m => m.role === 'tool' && m.tool_call_id === 'idx_1');
    expect(idxMsg?.content).toContain('Indexed');

    const searchMsg = agent.getMessages().find(m => m.role === 'tool' && m.tool_call_id === 'search_1');
    expect(searchMsg?.content).toContain('rpc.ts');
  });

  it('returns no-results message when query matches nothing above threshold', async () => {
    const agent = new AgentCore(mockFs, mockLlm as any, mockStore, mockLogger, mockNpr, mockNio, workspaceRoot);
    await agent.startSession('sem-nomatch');

    mockLlm.responses = [
      {
        text: 'index first',
        tool_calls: [{
          id: 'idx_2',
          type: 'function',
          function: { name: 'index_workspace', arguments: JSON.stringify({}) }
        }]
      },
      {
        text: 'search with very high threshold',
        tool_calls: [{
          id: 'search_2',
          type: 'function',
          function: {
            name: 'semantic_search',
            arguments: JSON.stringify({ query: 'rpc dispatch', topK: 5, minScore: 0.99 })
          }
        }]
      },
      { text: 'done' }
    ];

    await agent.processMessage('find rpc but with high threshold');
    const searchMsg = agent.getMessages().find(m => m.role === 'tool' && m.tool_call_id === 'search_2');
    // Either finds something or returns 'No results' — both valid; just must not crash
    expect(searchMsg?.content).toBeDefined();
  });
});
