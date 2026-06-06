import { z } from 'zod';
import { CoreToolDefinition, ToolContext } from './types';

const schema = z.object({
  path: z.string().describe('The relative path of the file to read')
});

export const readFileTool = (ctx: ToolContext): CoreToolDefinition<typeof schema> => ({
  name: 'read_file',
  annotations: { title: 'Read File', readOnlyHint: true, idempotentHint: true },
  description: 'Read the contents of a file from the workspace. You must read a file before modifying it.',
  schema,
  handler: async (args) => {
    const resolvedPath = ctx.resolveWorkspacePath(args.path);
    ctx.readFiles.add(resolvedPath);

    ctx.incrementConsecutiveReads();

    if (!(await ctx.fs.exists(resolvedPath))) {
      return `Error: File not found at path: ${args.path}`;
    }
    return ctx.fs.readFile(resolvedPath);
  }
});
