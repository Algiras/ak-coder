import { z } from 'zod';
import { CoreToolDefinition, ToolContext } from './types';

const schema = z.object({
  query: z.string().describe('Natural language query, e.g. "where do we handle JSON-RPC messages"'),
  topK: z.number().optional().describe('Maximum number of results to return (default 5)'),
  minScore: z.number().optional().describe('Minimum cosine similarity threshold 0–1 (default 0.1)')
});

export const semanticSearchTool = (ctx: ToolContext): CoreToolDefinition<typeof schema> => ({
  name: 'semantic_search',
  annotations: { title: 'Semantic Search', readOnlyHint: true, idempotentHint: true },
  description: 'Search the indexed workspace for files or code chunks semantically relevant to a query. Call index_workspace first.',
  schema,
  handler: async (args) => {
    if (ctx.vectorStore.size() === 0) {
      return 'The workspace index is empty. Please run the index_workspace tool first.';
    }
    const queryVec = ctx.getIndexer().embedQuery(args.query);
    const results = ctx.vectorStore.search(queryVec, args.topK ?? 5, args.minScore ?? 0.1);
    if (results.length === 0) {
      return `No results found for query: "${args.query}" (try lowering minScore or re-indexing).`;
    }
    return results
      .map((r, i) =>
        `[${i + 1}] ${r.filePath} (lines ${r.startLine + 1}–${r.endLine + 1}) | score: ${r.score.toFixed(4)}\n${r.text.slice(0, 300)}${r.text.length > 300 ? '…' : ''}`
      )
      .join('\n\n---\n\n');
  }
});
