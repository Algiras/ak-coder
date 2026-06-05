import { z } from 'zod';
import { CoreToolDefinition, ToolContext } from './types';

export const listDirectoryTool = (ctx: ToolContext): CoreToolDefinition => ({
  name: 'list_directory',
  annotations: { title: 'List Directory', readOnlyHint: true, idempotentHint: true },
  description: 'List the contents of a directory in the workspace.',
  schema: z.object({
    path: z.string().describe('The path of the directory to list')
  }),
  handler: async (args) => {
    const resolvedPath = ctx.resolveWorkspacePath(args.path || '.');
    ctx.incrementConsecutiveReads();

    if (!(await ctx.fs.exists(resolvedPath))) {
      return `Error: Directory not found: ${args.path}`;
    }
    const files = await ctx.fs.listFiles(resolvedPath);
    return files.join('\n');
  }
});
