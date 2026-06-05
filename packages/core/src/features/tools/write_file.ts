import { z } from 'zod';
import { CoreToolDefinition, ToolContext } from './types';
import { DiffEngine } from '../diff/diff';

export const writeFileTool = (ctx: ToolContext): CoreToolDefinition => ({
  name: 'write_file',
  annotations: { title: 'Write File', destructiveHint: true },
  description: 'Write complete new content to a file. A unified diff will be shown and requires explicit user confirmation. You must read the file first in the current session before writing.',
  schema: z.object({
    path: z.string().describe('The relative path of the file to write'),
    content: z.string().describe('The complete new content to write')
  }),
  handler: async (args) => {
    const resolvedPath = ctx.resolveWorkspacePath(args.path);
    let { content } = args;
    ctx.resetConsecutiveReads();

    if (!ctx.readFiles.has(resolvedPath)) {
      throw new Error(`Write-Only-After-Read lock violated: You must call 'read_file' on "${args.path}" before you can write to it.`);
    }

    if (ctx.hooks.beforeWriteFile) {
      const hookResult = await ctx.hooks.beforeWriteFile({
        sessionId: ctx.getSessionId() || 'unknown',
        workspaceRoot: ctx.workspaceRoot,
        path: args.path,
        content
      });
      if (hookResult?.cancel) {
        throw new Error(`Write operation for file "${args.path}" was cancelled by hook.`);
      }
      if (hookResult?.content !== undefined) {
        content = hookResult.content;
      }
    }

    const oldContent = (await ctx.fs.exists(resolvedPath)) ? await ctx.fs.readFile(resolvedPath) : '';
    const diffs = DiffEngine.compare(oldContent, content);
    const coloredDiff = DiffEngine.renderColorDiff(diffs);

    const confirmResult = await ctx.confirmationPolicy.check(
      'write_file',
      { action: 'write_file', description: `Write changes to ${args.path}`, detail: coloredDiff, path: args.path },
      ctx.terminalIo
    );
    if (!confirmResult.approved) {
      throw new Error(`User rejected changes to "${args.path}".`);
    }

    let writeSuccess = true;
    try {
      await ctx.fs.writeFile(resolvedPath, content);
      ctx.markModified();
    } catch (e) {
      writeSuccess = false;
      throw e;
    } finally {
      if (ctx.hooks.afterWriteFile) {
        await ctx.hooks.afterWriteFile({
          sessionId: ctx.getSessionId() || 'unknown',
          workspaceRoot: ctx.workspaceRoot,
          path: args.path,
          content,
          success: writeSuccess
        });
      }
    }

    return `Successfully wrote content to ${args.path}`;
  }
});
