import { z } from 'zod';
import { CoreToolDefinition, ToolContext } from './types';

export const bashTool = (ctx: ToolContext): CoreToolDefinition => ({
  name: 'bash',
  annotations: { title: 'Bash', destructiveHint: true, openWorldHint: true },
  description: 'Run a bash command. Read-only commands (ls, git status, cat, etc.) run automatically. Commands that mutate state require explicit user confirmation.',
  schema: z.object({
    command: z.string().describe('The shell command to run')
  }),
  handler: async (args) => {
    let { command } = args;
    ctx.resetConsecutiveReads();

    if (!ctx.processRunner) {
      throw new Error('ProcessRunner is not registered in the agent context');
    }

    if (ctx.hooks.beforeExecuteCommand) {
      const hookResult = await ctx.hooks.beforeExecuteCommand({
        sessionId: ctx.getSessionId() || 'unknown',
        workspaceRoot: ctx.workspaceRoot,
        command
      });
      if (hookResult?.cancel) {
        throw new Error(`Command execution was cancelled by hook: "${command}"`);
      }
      if (hookResult?.command !== undefined) {
        command = hookResult.command;
      }
    }

    const confirmResult = await ctx.confirmationPolicy.check(
      'bash',
      { action: 'bash', description: 'Run bash command', detail: command, command },
      ctx.terminalIo,
      ctx.safetyGate
    );
    if (!confirmResult.approved) {
      throw new Error(`User rejected command execution: "${command}"`);
    }
    if (confirmResult.edited) {
      command = confirmResult.edited;
    }
    if (confirmResult.applyToAll && confirmResult.approved) {
      await ctx.safetyGate.authorizePattern(command);
    }

    let runResult: any;
    try {
      runResult = await ctx.processRunner.run(command, { cwd: ctx.workspaceRoot });
    } catch (e) {
      if (ctx.hooks.afterExecuteCommand) {
        await ctx.hooks.afterExecuteCommand({
          sessionId: ctx.getSessionId() || 'unknown',
          workspaceRoot: ctx.workspaceRoot,
          command,
          code: null,
          stdout: '',
          stderr: (e as Error).message
        });
      }
      throw e;
    }

    if (ctx.hooks.afterExecuteCommand) {
      await ctx.hooks.afterExecuteCommand({
        sessionId: ctx.getSessionId() || 'unknown',
        workspaceRoot: ctx.workspaceRoot,
        command,
        code: runResult.code,
        stdout: runResult.stdout,
        stderr: runResult.stderr
      });
    }

    if (command.toLowerCase().includes('test')) {
      ctx.markTestsExecuted();
    }

    return `Exit Code: ${runResult.code}\nStdout:\n${runResult.stdout}\nStderr:\n${runResult.stderr}`;
  }
});
