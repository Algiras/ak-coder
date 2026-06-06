import { z } from 'zod';
import { CoreToolDefinition, ToolContext } from './types';
import { DiffEngine } from '../diff/diff';

const schema = z.object({
  path: z.string().describe('The relative path of the file to edit'),
  patches: z.array(z.object({
    find: z.string().describe('The exact block of code to find (including whitespace and indentation)'),
    replace: z.string().describe('The block of code to replace the "find" block with')
  })).describe('List of search-and-replace patches to apply sequentially')
});

export const patchFileTool = (ctx: ToolContext): CoreToolDefinition<typeof schema> => ({
  name: 'patch_file',
  annotations: { title: 'Patch File', destructiveHint: true },
  description: 'Apply search-and-replace patches to a file. Highly preferred over write_file for editing existing files.',
  schema,
  handler: async (args) => {
    const resolvedPath = ctx.resolveWorkspacePath(args.path);
    ctx.resetConsecutiveReads();

    if (!ctx.readFiles.has(resolvedPath)) {
      throw new Error(`Write-Only-After-Read lock violated: You must call 'read_file' on "${args.path}" before you can patch it.`);
    }
    if (!(await ctx.fs.exists(resolvedPath))) {
      throw new Error(`File not found at path: ${args.path}`);
    }

    const oldContent = await ctx.fs.readFile(resolvedPath);
    let content = oldContent;

    for (let idx = 0; idx < args.patches.length; idx++) {
      const { find, replace } = args.patches[idx];
      const occurrences = content.split(find).length - 1;
      if (occurrences === 0) {
        throw new Error(`Patch failed at index ${idx}: The text to find was not found in the file.`);
      }
      if (occurrences > 1) {
        throw new Error(`Patch failed at index ${idx}: The text to find is not unique (found ${occurrences} times).`);
      }
      content = content.replace(find, replace);
    }

    if (ctx.hooks.beforeWriteFile) {
      const hookResult = await ctx.hooks.beforeWriteFile({
        sessionId: ctx.getSessionId() || 'unknown',
        workspaceRoot: ctx.workspaceRoot,
        path: args.path,
        content
      });
      if (hookResult?.cancel) {
        throw new Error(`Patch operation for file "${args.path}" was cancelled by hook.`);
      }
      if (hookResult?.content !== undefined) {
        content = hookResult.content;
      }
    }

    const diffs = DiffEngine.compare(oldContent, content);
    const coloredDiff = DiffEngine.renderColorDiff(diffs);

    const confirmResult = await ctx.confirmationPolicy.check(
      'patch_file',
      { action: 'patch_file', description: `Apply ${args.patches.length} patch(es) to ${args.path}`, detail: coloredDiff, path: args.path },
      ctx.terminalIo
    );
    if (!confirmResult.approved) {
      throw new Error(`User rejected changes to "${args.path}".`);
    }

    let writeSuccess = true;
    try {
      await ctx.fs.writeFile(resolvedPath, content);
      ctx.readFiles.add(resolvedPath);
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

    return `Successfully applied ${args.patches.length} patches to ${args.path}`;
  }
});
