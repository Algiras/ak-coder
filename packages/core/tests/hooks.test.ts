import { describe, it, expect, beforeEach } from 'bun:test';
import { AgentCore } from '../src/agent';
import { ChatMessage } from '../src/ports';
import { AgentHooks } from '../src/features/hooks/hooks';
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

describe('AgentCore Hooks System', () => {
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

  it('should trigger beforeChat and afterChat hooks', async () => {
    const agent = new AgentCore(mockFs, mockLlm as any, mockStore, mockLogger, mockNpr, mockNio, workspaceRoot);
    await agent.startSession('test-session-hooks');

    let beforeChatTriggered = false;
    let afterChatTriggered = false;

    agent.registerHooks({
      beforeChat: (messages) => {
        beforeChatTriggered = true;
        // Modify prompt content in messages
        const lastMsg = messages[messages.length - 1];
        lastMsg.content = lastMsg.content + ' [modified by beforeChat]';
        return messages;
      },
      afterChat: (response) => {
        afterChatTriggered = true;
        return response + ' [modified by afterChat]';
      }
    });

    mockLlm.responses = [{ text: 'Hello developer!' }];

    const result = await agent.processMessage('Hello agent');
    expect(beforeChatTriggered).toBe(true);
    expect(afterChatTriggered).toBe(true);
    
    // Assert the last message sent to LLM had the modified suffix
    const lastPromptMsg = mockLlm.lastPrompt[mockLlm.lastPrompt.length - 1];
    expect(lastPromptMsg.content).toContain('[modified by beforeChat]');
    
    // Assert the final result has the afterChat suffix
    expect(result.text).toBe('Hello developer! [modified by afterChat]');
  });

  it('should trigger beforeWriteFile hook and allow modification or cancellation', async () => {
    const agent = new AgentCore(mockFs, mockLlm as any, mockStore, mockLogger, mockNpr, mockNio, workspaceRoot);
    await agent.startSession('test-session-write-hooks');

    await mockFs.writeFile('/workspace/file.txt', 'original content');
    // Lock check: read the file first
    agent.registerHooks({
      beforeWriteFile: (ctx) => {
        if (ctx.content.includes('cancel-me')) {
          return { cancel: true };
        }
        return { content: ctx.content + ' [hook-suffix]' };
      }
    });

    mockNio.confirmResults = [{ approved: true, applyToAll: false }]; // user approves writing changes
    mockLlm.responses = [
      {
        text: 'Read first',
        tool_calls: [
          {
            id: 'read_1',
            type: 'function',
            function: { name: 'read_file', arguments: JSON.stringify({ path: 'file.txt' }) }
          }
        ]
      },
      {
        text: 'Write with modification',
        tool_calls: [
          {
            id: 'write_1',
            type: 'function',
            function: { name: 'write_file', arguments: JSON.stringify({ path: 'file.txt', content: 'new content' }) }
          }
        ]
      },
      { text: 'Done write!' }
    ];

    await agent.processMessage('perform write');
    const finalContent = await mockFs.readFile('/workspace/file.txt');
    // Verify beforeWriteFile modified the written content
    expect(finalContent).toBe('new content [hook-suffix]');

    // Verify cancellation
    mockLlm.responses = [
      {
        text: 'Write to cancel',
        tool_calls: [
          {
            id: 'write_cancel',
            type: 'function',
            function: { name: 'write_file', arguments: JSON.stringify({ path: 'file.txt', content: 'cancel-me content' }) }
          }
        ]
      },
      { text: 'Did it write?' }
    ];

    await agent.processMessage('write cancelled content');
    const toolMsg = agent.getMessages().find(m => m.role === 'tool' && m.tool_call_id === 'write_cancel');
    expect(toolMsg).toBeDefined();
    expect(toolMsg?.content).toContain('cancelled by hook');
    // Ensure content remained the same
    expect(await mockFs.readFile('/workspace/file.txt')).toBe('new content [hook-suffix]');
  });

  it('should trigger afterWriteFile hook after successful or failed write', async () => {
    const agent = new AgentCore(mockFs, mockLlm as any, mockStore, mockLogger, mockNpr, mockNio, workspaceRoot);
    await agent.startSession('test-session-after-write');

    await mockFs.writeFile('/workspace/file.txt', 'original');

    let afterWriteTriggered = false;
    let hookSuccessState = false;

    agent.registerHooks({
      afterWriteFile: (ctx) => {
        afterWriteTriggered = true;
        hookSuccessState = ctx.success;
      }
    });

    mockNio.confirmResults = [{ approved: true, applyToAll: false }];
    mockLlm.responses = [
      {
        text: 'Read first',
        tool_calls: [
          {
            id: 'read_1',
            type: 'function',
            function: { name: 'read_file', arguments: JSON.stringify({ path: 'file.txt' }) }
          }
        ]
      },
      {
        text: 'Write content',
        tool_calls: [
          {
            id: 'write_1',
            type: 'function',
            function: { name: 'write_file', arguments: JSON.stringify({ path: 'file.txt', content: 'new data' }) }
          }
        ]
      },
      { text: 'Done!' }
    ];

    await agent.processMessage('write');
    expect(afterWriteTriggered).toBe(true);
    expect(hookSuccessState).toBe(true);
  });

  it('should trigger beforeExecuteCommand and afterExecuteCommand hooks', async () => {
    const agent = new AgentCore(mockFs, mockLlm as any, mockStore, mockLogger, mockNpr, mockNio, workspaceRoot);
    await agent.startSession('test-session-command-hooks');

    let beforeCommandTriggered = false;
    let afterCommandTriggered = false;

    agent.registerHooks({
      beforeExecuteCommand: (ctx) => {
        beforeCommandTriggered = true;
        if (ctx.command === 'cancel-command') {
          return { cancel: true };
        }
        return { command: ctx.command + ' --verbose' };
      },
      afterExecuteCommand: (ctx) => {
        afterCommandTriggered = true;
      }
    });

    mockLlm.responses = [
      {
        text: 'Run cmd',
        tool_calls: [
          {
            id: 'cmd_1',
            type: 'function',
            function: { name: 'bash', arguments: JSON.stringify({ command: 'ls' }) }
          }
        ]
      },
      { text: 'Done command!' }
    ];

    await agent.processMessage('run command');
    expect(beforeCommandTriggered).toBe(true);
    expect(afterCommandTriggered).toBe(true);
    expect(mockNpr.commands[0]).toBe('ls --verbose');

    // Test command cancellation
    mockLlm.responses = [
      {
        text: 'Run cancel cmd',
        tool_calls: [
          {
            id: 'cmd_cancel',
            type: 'function',
            function: { name: 'bash', arguments: JSON.stringify({ command: 'cancel-command' }) }
          }
        ]
      },
      { text: 'Finished!' }
    ];

    await agent.processMessage('run cancelled command');
    const toolMsg = agent.getMessages().find(m => m.role === 'tool' && m.tool_call_id === 'cmd_cancel');
    expect(toolMsg).toBeDefined();
    expect(toolMsg?.content).toContain('cancelled by hook');
  });
});
