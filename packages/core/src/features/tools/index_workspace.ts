import { z } from 'zod';
import { CoreToolDefinition, ToolContext } from './types';
import { WorkspaceIndexer } from '../history/indexer';

export const indexWorkspaceTool = (ctx: ToolContext): CoreToolDefinition => ({
  name: 'index_workspace',
  description: 'Index the workspace files for semantic search. Call this once before using semantic_search. Respects .gitignore patterns.',
  schema: z.object({
    extensions: z.array(z.string()).optional().describe('File extensions to include (e.g. [".ts", ".md"]). Defaults to common code/text extensions.')
  }),
  handler: async (args) => {
    const opts = args.extensions ? { extensions: args.extensions } : {};
    const indexer = new WorkspaceIndexer(ctx.vectorStore, opts);
    ctx.setIndexer(indexer);
    await indexer.indexWorkspace(ctx.fs, ctx.workspaceRoot);
    const fileCount = ctx.vectorStore.indexedFiles().length;
    const chunkCount = ctx.vectorStore.size();
    return `Indexed ${fileCount} files into ${chunkCount} chunks. Semantic search is now ready.`;
  }
});
