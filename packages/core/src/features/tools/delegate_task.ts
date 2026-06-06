import { z } from 'zod';
import { CoreToolDefinition, ToolContext } from './types';
import { runSubAgent } from './subagent-io';

const schema = z.object({
  role: z.string().describe('The specialized role of the sub-agent (e.g. "Security Auditor", "Test Runner")'),
  taskPrompt: z.string().describe('The detailed instructions and objective of the task for the sub-agent'),
  filesToInclude: z.array(z.string()).optional().describe("Relative paths of files to load in the sub-agent's context")
});

export const delegateTaskTool = (ctx: ToolContext): CoreToolDefinition<typeof schema> => ({
  name: 'delegate_task',
  annotations: { title: 'Delegate Task', openWorldHint: true },
  description: "Deploy a specialized sub-agent to execute a sub-task. Returns the sub-agent's findings.",
  schema,
  handler: async (args) => {
    const { role, taskPrompt, filesToInclude } = args;
    const maxDepth = 3;
    if (ctx.delegationDepth >= maxDepth) {
      throw new Error(`Sub-agent delegation depth limit of ${maxDepth} exceeded. Spawning rejected.`);
    }

    const subSessionId = `${ctx.getSessionId() || 'sub'}-depth-${ctx.delegationDepth + 1}-${Date.now()}`;
    const child = ctx.createChildAgent(subSessionId);
    child.agentsRules = `You are a specialized sub-agent with the role: "${role}".\nYour parent task instruction is:\n${taskPrompt}\n\nProvide a direct and detailed technical summary of your findings or implementation when you are done.`;

    if (filesToInclude) {
      for (const file of filesToInclude) {
        try {
          await child.addFileToContext(ctx.resolveWorkspacePath(file));
        } catch (e) {
          ctx.logger.warn(`Failed to add file to child context: ${file}`, e);
        }
      }
    }

    await child.startSession(subSessionId);

    const response = await runSubAgent({
      terminalIo: ctx.terminalIo,
      role,
      depth: ctx.delegationDepth + 1,
      transcript: 'silent',
      run: (stream) => child.processMessage(`Begin task: "${taskPrompt}"`, [], stream)
    });

    return `[Sub-Agent "${role}" finished execution]\nSummary of Findings:\n${response.text}`;
  }
});
