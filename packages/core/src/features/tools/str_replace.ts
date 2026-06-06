import { z } from 'zod';
import { CoreToolDefinition, ToolContext } from './types';
import { isSkillFilePath } from '../skills/skills';

const schema = z.object({
  path: z.string().describe('Path to the file to edit'),
  old_string: z.string().describe('The exact string to find and replace (must be unique in the file)'),
  new_string: z.string().describe('The replacement string')
});

export const strReplaceTool = (ctx: ToolContext): CoreToolDefinition<typeof schema> => ({
  name: 'str_replace',
  annotations: { title: 'String Replace', destructiveHint: true },
  description: 'Replace an exact string in a file. Simpler than patch_file for targeted single-location edits. The file must have been read first.',
  schema,
  handler: async (args) => {
    const resolvedPath = ctx.resolveWorkspacePath(args.path);
    if (!ctx.readFiles.has(resolvedPath)) {
      return `Error: You must read "${args.path}" with read_file before editing it.`;
    }
    const content = await ctx.fs.readFile(resolvedPath);
    const occurrences = content.split(args.old_string).length - 1;
    if (occurrences === 0) return `Error: old_string not found in ${args.path}`;
    if (occurrences > 1) {
      return `Error: old_string found ${occurrences} times in ${args.path} — provide more surrounding context to make it unique.`;
    }

    const updated = content.replace(args.old_string, args.new_string);
    const approval = await ctx.confirmationPolicy.check(
      'patch_file',
      {
        action: 'patch_file',
        description: `Edit ${args.path}`,
        detail: `- ${args.old_string.slice(0, 120)}\n+ ${args.new_string.slice(0, 120)}`,
        path: resolvedPath
      },
      ctx.terminalIo
    );
    if (!approval.approved) return `Edit to ${args.path} was rejected.`;

    if (ctx.hooks.beforeWriteFile) {
      const hookResult = await ctx.hooks.beforeWriteFile({ path: resolvedPath, content: updated, sessionId: ctx.getSessionId() || '', workspaceRoot: ctx.workspaceRoot });
      if (hookResult?.cancel) return `Edit to ${args.path} cancelled by before-write hook.`;
    }
    await ctx.fs.writeFile(resolvedPath, updated);
    ctx.readFiles.add(resolvedPath);
    ctx.markModified();
    if (ctx.hooks.afterWriteFile) {
      await ctx.hooks.afterWriteFile({ path: resolvedPath, content: updated, sessionId: ctx.getSessionId() || '', workspaceRoot: ctx.workspaceRoot, success: true });
    }
    if (isSkillFilePath(resolvedPath)) {
      await ctx.reloadSkills?.();
      return `Edited ${args.path} successfully. Skills reloaded.`;
    }
    return `Edited ${args.path} successfully.`;
  }
});
