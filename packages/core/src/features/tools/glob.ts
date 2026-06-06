import { z } from 'zod';
import { CoreToolDefinition, ToolContext } from './types';

const schema = z.object({
  pattern: z.string().describe('Glob pattern, e.g. "**/*.ts" or "src/**/*.test.ts"'),
  path: z.string().optional().describe('Root directory to search (default: workspace root)')
});

export const globTool = (ctx: ToolContext): CoreToolDefinition<typeof schema> => ({
  name: 'glob',
  annotations: { title: 'Glob', readOnlyHint: true, idempotentHint: true },
  description: 'Find files matching a glob pattern within the workspace (e.g. "**/*.ts", "src/**/*.test.ts").',
  schema,
  handler: async (args) => {
    ctx.incrementConsecutiveReads();
    const root = args.path && args.path !== '.'
      ? ctx.resolveWorkspacePath(args.path)
      : ctx.workspaceRoot;

    if (ctx.processRunner) {
      try {
        const result = await ctx.processRunner.run(
          `rg --files -g ${JSON.stringify(args.pattern)} ${JSON.stringify(root)}`,
          { cwd: ctx.workspaceRoot }
        );
        const lines = result.stdout.trim().split('\n').filter(Boolean);
        if (lines.length === 0) return `No files found matching: ${args.pattern}`;
        return lines.slice(0, 200).join('\n');
      } catch {
        // fall through to in-process scan
      }
    }

    // In-process fallback: convert glob to regex
    const allFiles = await ctx.fs.listFiles(root);
    const parts = args.pattern.split('**');
    const regexStr = parts
      .map(p => p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
      .join('.*');
    const regex = new RegExp(`(^|/)${regexStr}$`);
    const matched = allFiles.filter(f => regex.test(f));
    if (matched.length === 0) return `No files found matching: ${args.pattern}`;
    return matched.slice(0, 200).join('\n');
  }
});
