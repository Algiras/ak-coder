import { z } from 'zod';
import { CoreToolDefinition, ToolContext } from './types';
import { DiffEngine } from '../diff/diff';
import { isSkillFilePath } from '../skills/skills';

const schema = z.object({
  path: z.string().describe('The relative path of the file to write'),
  content: z.string().describe('The complete new content to write')
});

export const writeFileTool = (ctx: ToolContext): CoreToolDefinition<typeof schema> => ({
  name: 'write_file',
  annotations: { title: 'Write File', destructiveHint: true },
  description: 'Write complete new content to a file. New files are created immediately without a confirmation prompt. Overwriting an existing file requires read_file first and shows a diff for approval.',
  schema,
  handler: async (args) => {
    const resolvedPath = ctx.resolveWorkspacePath(args.path);
    let { content } = args;
    ctx.resetConsecutiveReads();

    const exists = await ctx.fs.exists(resolvedPath);
    if (exists && !ctx.readFiles.has(resolvedPath)) {
      throw new Error(`Write-Only-After-Read lock violated: You must call 'read_file' on "${args.path}" before you can overwrite it.`);
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

    const writeMode = ctx.confirmationPolicy.getConfig().writes;
    const mustConfirm = exists || writeMode === 'deny';

    if (mustConfirm) {
      const detail = exists
        ? DiffEngine.renderColorDiff(DiffEngine.compare(await ctx.fs.readFile(resolvedPath), content))
        : `Create new file ${args.path}`;

      const confirmResult = await ctx.confirmationPolicy.check(
        'write_file',
        { action: 'write_file', description: exists ? `Write changes to ${args.path}` : `Create ${args.path}`, detail, path: args.path },
        ctx.terminalIo
      );
      if (!confirmResult.approved) {
        throw new Error(exists
          ? `User rejected changes to "${args.path}".`
          : `Write to "${args.path}" blocked by confirmation policy.`);
      }
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

    if (writeSuccess && isSkillFilePath(resolvedPath)) {
      await ctx.reloadSkills?.();
    }

    return writeSuccess && isSkillFilePath(resolvedPath)
      ? `Successfully wrote content to ${args.path}. Skills reloaded.`
      : `Successfully wrote content to ${args.path}`;
  }
});
