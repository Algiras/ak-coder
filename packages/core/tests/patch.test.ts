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
      options.stream({ type: 'content', text: resp.text });
    }
    return {
      text: resp.text,
      inputTokens: 10,
      outputTokens: 15,
      tool_calls: resp.tool_calls
    };
  }
}

describe('AgentCore patch_file Tool', () => {
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

  it('should apply search-and-replace patches successfully', async () => {
    const agent = new AgentCore(mockFs, mockLlm as any, mockStore, mockLogger, mockNpr, mockNio, workspaceRoot);
    await agent.startSession('patch-session');

    const originalContent = 'line 1\nline 2\nline 3\n';
    await mockFs.writeFile('/workspace/file.txt', originalContent);

    mockNio.confirmResults = [{ approved: true, applyToAll: false }]; // user approves patch
    mockLlm.responses = [
      {
        text: 'Read first to unlock write lock',
        tool_calls: [
          {
            id: 'read_1',
            type: 'function',
            function: { name: 'read_file', arguments: JSON.stringify({ path: 'file.txt' }) }
          }
        ]
      },
      {
        text: 'Apply patch to line 2',
        tool_calls: [
          {
            id: 'patch_1',
            type: 'function',
            function: {
              name: 'patch_file',
              arguments: JSON.stringify({
                path: 'file.txt',
                patches: [{ find: 'line 2', replace: 'line two (patched)' }]
              })
            }
          }
        ]
      },
      { text: 'All done!' }
    ];

    await agent.processMessage('replace line 2');
    const finalContent = await mockFs.readFile('/workspace/file.txt');
    expect(finalContent).toBe('line 1\nline two (patched)\nline 3\n');
  });

  it('should enforce write lock and refuse patch if file is not read first', async () => {
    const agent = new AgentCore(mockFs, mockLlm as any, mockStore, mockLogger, mockNpr, mockNio, workspaceRoot);
    await agent.startSession('patch-session-lock');

    await mockFs.writeFile('/workspace/file.txt', 'hello');

    mockLlm.responses = [
      {
        text: 'Patch file without reading',
        tool_calls: [
          {
            id: 'patch_no_read',
            type: 'function',
            function: {
              name: 'patch_file',
              arguments: JSON.stringify({
                path: 'file.txt',
                patches: [{ find: 'hello', replace: 'world' }]
              })
            }
          }
        ]
      },
      { text: 'Finished' }
    ];

    await agent.processMessage('patch file');
    const toolMsg = agent.getMessages().find(m => m.role === 'tool' && m.tool_call_id === 'patch_no_read');
    expect(toolMsg).toBeDefined();
    expect(toolMsg?.content).toContain('Write-Only-After-Read lock violated');
  });

  it('should reject patch if the search pattern is not unique or not found', async () => {
    const agent = new AgentCore(mockFs, mockLlm as any, mockStore, mockLogger, mockNpr, mockNio, workspaceRoot);
    await agent.startSession('patch-session-fail');

    await mockFs.writeFile('/workspace/file.txt', 'hello hello world');

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
        text: 'Patch non-unique element',
        tool_calls: [
          {
            id: 'patch_non_unique',
            type: 'function',
            function: {
              name: 'patch_file',
              arguments: JSON.stringify({
                path: 'file.txt',
                patches: [{ find: 'hello', replace: 'hi' }] // appears twice
              })
            }
          }
        ]
      },
      {
        text: 'Patch not found element',
        tool_calls: [
          {
            id: 'patch_not_found',
            type: 'function',
            function: {
              name: 'patch_file',
              arguments: JSON.stringify({
                path: 'file.txt',
                patches: [{ find: 'absent-text', replace: 'hi' }]
              })
            }
          }
        ]
      },
      { text: 'Done' }
    ];

    await agent.processMessage('patch file');
    
    const nonUniqueMsg = agent.getMessages().find(m => m.role === 'tool' && m.tool_call_id === 'patch_non_unique');
    expect(nonUniqueMsg?.content).toContain('not unique');

    const notFoundMsg = agent.getMessages().find(m => m.role === 'tool' && m.tool_call_id === 'patch_not_found');
    expect(notFoundMsg?.content).toContain('not found in the file');
  });
});
