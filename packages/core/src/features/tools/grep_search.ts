import { z } from 'zod';
import { CoreToolDefinition, ToolContext } from './types';

const schema = z.object({
  pattern: z.string().describe('The text pattern or regex to search for'),
  path: z.string().describe('The directory path to search')
});

export const grepSearchTool = (ctx: ToolContext): CoreToolDefinition<typeof schema> => ({
  name: 'grep_search',
  annotations: { title: 'Grep Search', readOnlyHint: true, idempotentHint: true },
  description: 'Search for text matches within workspace files.',
  schema,
  handler: async (args) => {
    const searchPath = args.path || '.';
    const resolvedPath = ctx.resolveWorkspacePath(searchPath);
    ctx.incrementConsecutiveReads();

    if (!(await ctx.fs.exists(resolvedPath))) {
      return `Error: Path not found: ${searchPath}`;
    }

    // Use ripgrep via ProcessRunner when available
    if (ctx.processRunner) {
      try {
        const result = await ctx.processRunner.run(
          `rg -n --no-heading -i -e ${JSON.stringify(args.pattern)} ${JSON.stringify(resolvedPath)}`,
          { cwd: ctx.workspaceRoot }
        );
        const output = result.stdout.trim();
        if (!output) return `No matches found for pattern: ${args.pattern}`;
        return result.stdout.trim().split('\n').slice(0, 100).join('\n');
      } catch {
        // rg not installed — fall through to in-process scan
      }
    }

    // In-process fallback (used in tests with MockFileSystem)
    const files = await ctx.fs.listFiles(resolvedPath);
    const matches: string[] = [];
    const regex = new RegExp(args.pattern, 'i');
    for (const file of files) {
      try {
        if (file.includes('node_modules') || file.includes('.git')) continue;
        const content = await ctx.fs.readFile(file);
        content.split('\n').forEach((line, idx) => {
          if (regex.test(line)) matches.push(`${file}:${idx + 1}: ${line.trim()}`);
        });
      } catch {
        // ignore unreadable files
      }
    }
    if (matches.length === 0) return `No matches found for pattern: ${args.pattern}`;
    return matches.slice(0, 100).join('\n');
  }
});
