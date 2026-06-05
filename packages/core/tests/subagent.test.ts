import { describe, it, expect, beforeEach } from 'bun:test';
import { AgentCore } from '../src/agent';
import { ChatMessage } from '../src/ports';
import {
  MockFileSystem,
  MockSessionStore,
  MockLogger,
  MockTerminalIo,
  MockProcessRunner
} from '../src/mocks';

class QueueMockLlmService {
  public responses: { text: string; tool_calls?: any[] }[] = [];
  public lastPrompt: ChatMessage[] = [];

  async chat(
    messages: ChatMessage[],
    options?: { stream?: (chunk: string) => void; signal?: AbortSignal; tools?: any[] }
  ): Promise<{ text: string; inputTokens: number; outputTokens: number; tool_calls?: any[] }> {
    this.lastPrompt = messages;
    const resp = this.responses.shift() || { text: 'Default fallback response' };
    if (options?.stream && resp.text) {
      options.stream(resp.text);
    }
    return {
      text: resp.text,
      inputTokens: 10,
      outputTokens: 15,
      tool_calls: resp.tool_calls
    };
  }
}

describe('AgentCore Sub-agents System', () => {
  let mockFs: MockFileSystem;
  let mockLlm: QueueMockLlmService;
  let mockStore: MockSessionStore;
  let mockLogger: MockLogger;
  let mockNio: MockTerminalIo;
  let mockNpr: MockProcessRunner;
  let workspaceRoot = '/workspace';

  beforeEach(() => {
    mockFs = new MockFileSystem();
    mockLlm = new QueueMockLlmService();
    mockStore = new MockSessionStore();
    mockLogger = new MockLogger();
    mockNio = new MockTerminalIo();
    mockNpr = new MockProcessRunner();
  });

  it('should list delegate_task tool', async () => {
    const agent = new AgentCore(mockFs, mockLlm as any, mockStore, mockLogger, mockNpr, mockNio, workspaceRoot);
    const tools = await (agent as any).getCombinedToolsList();
    const toolNames = tools.map((t: any) => t.function.name);
    expect(toolNames).toContain('delegate_task');
  });

  it('should successfully spawn a child agent and return findings', async () => {
    const agent = new AgentCore(mockFs, mockLlm as any, mockStore, mockLogger, mockNpr, mockNio, workspaceRoot);
    await agent.startSession('parent-session');
    await mockFs.writeFile('/workspace/code.js', 'console.log("hello");');

    // LLM response for parent tool call
    mockLlm.responses = [
      {
        text: 'Let me delegate this code review to a specialized child agent',
        tool_calls: [
          {
            id: 'delegate_1',
            type: 'function',
            function: {
              name: 'delegate_task',
              arguments: JSON.stringify({
                role: 'Code Reviewer',
                taskPrompt: 'Review code.js and check for quality issues',
                filesToInclude: ['code.js']
              })
            }
          }
        ]
      },
      // Child response payload response from LLM (child agent's response)
      {
        text: 'I have reviewed code.js. It looks clean and uses modern JavaScript standards.'
      },
      // Final parent response
      {
        text: 'The sub-agent reviewed the file and confirmed it is clean.'
      }
    ];

    const result = await agent.processMessage('Please review our codebase');
    
    // Check stdout logs from subagent spawning
    expect(mockNio.outputs.some(o => o.includes('Spawning Sub-Agent: "Code Reviewer"'))).toBe(true);
    expect(mockNio.outputs.some(o => o.includes('Sub-Agent "Code Reviewer" finished execution'))).toBe(true);

    expect(result.text).toBe('The sub-agent reviewed the file and confirmed it is clean.');
  });

  it('should reject spawning if delegation depth limit is exceeded', async () => {
    const agent = new AgentCore(mockFs, mockLlm as any, mockStore, mockLogger, mockNpr, mockNio, workspaceRoot);
    await agent.startSession('parent-session-limit');
    agent.delegationDepth = 3; // set at max limit

    mockLlm.responses = [
      {
        text: 'Delegate task',
        tool_calls: [
          {
            id: 'delegate_fail',
            type: 'function',
            function: {
              name: 'delegate_task',
              arguments: JSON.stringify({
                role: 'Deep Subagent',
                taskPrompt: 'Should fail'
              })
            }
          }
        ]
      },
      { text: 'Spawning failed' }
    ];

    await agent.processMessage('delegate please');
    const toolMsg = agent.getMessages().find(m => m.role === 'tool' && m.tool_call_id === 'delegate_fail');
    expect(toolMsg).toBeDefined();
    expect(toolMsg?.content).toContain('delegation depth limit of 3 exceeded');
  });
});
