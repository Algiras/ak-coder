import { describe, it, expect, beforeEach } from 'bun:test';
import { AgentCore } from '../src/agent';
import { LLMService, ChatMessage } from '../src/ports';
import {
  MockFileSystem,
  MockSessionStore,
  MockLogger,
  MockTerminalIo,
  MockProcessRunner
} from '../src/mocks';

class QueueMockLlmService implements LLMService {
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

describe('AgentCore Tool Calling ReAct Loop', () => {
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

  it('should expose combined tools list containing system tools', async () => {
    const agent = new AgentCore(mockFs, mockLlm, mockStore, mockLogger, mockNpr, mockNio, workspaceRoot);
    const tools = await (agent as any).getCombinedToolsList();
    const toolNames = tools.map((t: any) => t.function.name);
    
    expect(toolNames).toContain('read_file');
    expect(toolNames).toContain('write_file');
    expect(toolNames).toContain('execute_command');
    expect(toolNames).toContain('list_directory');
    expect(toolNames).toContain('grep_search');
  });

  it('should run safe commands automatically and prompt for unsafe commands', async () => {
    const agent = new AgentCore(mockFs, mockLlm, mockStore, mockLogger, mockNpr, mockNio, workspaceRoot);
    await agent.startSession('test-session-safety');

    // Scenario 1: Safe command 'ls'
    mockLlm.responses = [
      {
        text: 'Let me list files',
        tool_calls: [
          {
            id: 'call_ls',
            type: 'function',
            function: { name: 'execute_command', arguments: JSON.stringify({ command: 'ls' }) }
          }
        ]
      },
      { text: 'Done listing files!' }
    ];

    let result = await agent.processMessage('list files');
    expect(result.text).toBe('Done listing files!');
    expect(mockNio.outputs).toHaveLength(1); // just loader warning
    expect(mockNio.confirms).toHaveLength(0); // no safety confirm prompted

    // Scenario 2: Unsafe command rejected by user
    mockNio.confirms = [false]; // user rejects unsafe command
    mockLlm.responses = [
      {
        text: 'Let me destroy everything',
        tool_calls: [
          {
            id: 'call_rm',
            type: 'function',
            function: { name: 'execute_command', arguments: JSON.stringify({ command: 'rm -rf src/' }) }
          }
        ]
      },
      { text: 'Failed to run command' }
    ];

    result = await agent.processMessage('delete src');
    const lastToolResponse = agent.getMessages().filter(m => m.role === 'tool').pop();
    expect(lastToolResponse).toBeDefined();
    expect(lastToolResponse?.content).toContain('User rejected command execution');
  });

  it('should enforce Write-Only-After-Read safety lock', async () => {
    const agent = new AgentCore(mockFs, mockLlm, mockStore, mockLogger, mockNpr, mockNio, workspaceRoot);
    await agent.startSession('test-session-lock');

    // Write to a file without reading it first
    mockLlm.responses = [
      {
        text: 'Let me write directly to a file',
        tool_calls: [
          {
            id: 'call_write',
            type: 'function',
            function: { name: 'write_file', arguments: JSON.stringify({ path: 'new_file.txt', content: 'hello' }) }
          }
        ]
      },
      { text: 'Did it write?' }
    ];

    await agent.processMessage('write hello to new_file.txt');
    const toolMsg = agent.getMessages().find(m => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg?.content).toContain('Write-Only-After-Read lock violated');

    // Read first, then write - should succeed
    await mockFs.writeFile('/workspace/existing.txt', 'old content');
    mockNio.confirms = [true]; // confirm file write

    mockLlm.responses = [
      {
        text: 'First I read',
        tool_calls: [
          {
            id: 'call_read',
            type: 'function',
            function: { name: 'read_file', arguments: JSON.stringify({ path: 'existing.txt' }) }
          }
        ]
      },
      {
        text: 'Now I write',
        tool_calls: [
          {
            id: 'call_write_ok',
            type: 'function',
            function: { name: 'write_file', arguments: JSON.stringify({ path: 'existing.txt', content: 'new content' }) }
          }
        ]
      },
      { text: 'All done!' }
    ];

    const res2 = await agent.processMessage('read and update existing.txt');
    expect(res2.text).toBe('All done!');
    const finalContent = await mockFs.readFile('/workspace/existing.txt');
    expect(finalContent).toBe('new content');
  });

  it('should enforce consecutive tool calling limit of 25 loops', async () => {
    const agent = new AgentCore(mockFs, mockLlm, mockStore, mockLogger, mockNpr, mockNio, workspaceRoot);
    await agent.startSession('test-session-limit');

    // LLM keeps returning tool calls endlessly
    const infiniteTools: any[] = [];
    for (let i = 0; i < 30; i++) {
      infiniteTools.push({
        text: `Loop ${i}`,
        tool_calls: [
          {
            id: `call_${i}`,
            type: 'function',
            function: { name: 'list_directory', arguments: JSON.stringify({ path: '.' }) }
          }
        ]
      });
    }
    mockLlm.responses = infiniteTools;

    const result = await agent.processMessage('loop infinitely');
    expect(result.text).toContain('Consecutive tool execution limit of 25 calls reached');
  });

  it('should track heuristics (over-reading and test verification)', async () => {
    const agent = new AgentCore(mockFs, mockLlm, mockStore, mockLogger, mockNpr, mockNio, workspaceRoot);
    await agent.startSession('test-session-heuristics');

    // Heuristic 1: Over-reading warning on 6 consecutive reads
    await mockFs.writeFile('/workspace/file1.txt', '1');
    mockLlm.responses = [
      {
        text: 'Read a lot of files',
        tool_calls: Array.from({ length: 6 }).map((_, i) => ({
          id: `read_${i}`,
          type: 'function',
          function: { name: 'read_file', arguments: JSON.stringify({ path: 'file1.txt' }) }
        }))
      },
      { text: 'Done reading!' }
    ];

    await agent.processMessage('read file 6 times');
    // Check if over-reading warning was written to TerminalIo
    const warnings = mockNio.outputs.filter(o => o.includes('Heuristic Alert: Agent has read'));
    expect(warnings.length).toBeGreaterThan(0);

    // Heuristic 2: Modify file but do not run tests
    mockNio.confirms = [true]; // confirm writing
    mockLlm.responses = [
      {
        text: 'Modify file1',
        tool_calls: [
          {
            id: 'read_before_write',
            type: 'function',
            function: { name: 'read_file', arguments: JSON.stringify({ path: 'file1.txt' }) }
          }
        ]
      },
      {
        text: 'Perform modification',
        tool_calls: [
          {
            id: 'write_file1',
            type: 'function',
            function: { name: 'write_file', arguments: JSON.stringify({ path: 'file1.txt', content: 'new content' }) }
          }
        ]
      },
      { text: 'Modification done!' }
    ];

    mockNio.outputs = []; // clear outputs
    await agent.processMessage('modify file');
    
    // Check that warnings about missing tests were printed
    const testWarning = mockNio.outputs.filter(o => o.includes('Heuristic Alert: Files modified but no test commands executed'));
    expect(testWarning.length).toBe(1);

    // Now modify file AND run tests - should not warn
    mockNio.confirms = [true, true, false]; // confirm write, confirm unsafe test command, reject save pattern
    mockLlm.responses = [
      {
        text: 'Read before write',
        tool_calls: [
          {
            id: 'read_file1_again',
            type: 'function',
            function: { name: 'read_file', arguments: JSON.stringify({ path: 'file1.txt' }) }
          }
        ]
      },
      {
        text: 'Perform modification',
        tool_calls: [
          {
            id: 'write_file1_again',
            type: 'function',
            function: { name: 'write_file', arguments: JSON.stringify({ path: 'file1.txt', content: 'new content 2' }) }
          }
        ]
      },
      {
        text: 'Now execute test',
        tool_calls: [
          {
            id: 'run_tests',
            type: 'function',
            function: { name: 'execute_command', arguments: JSON.stringify({ command: 'bun test' }) }
          }
        ]
      },
      { text: 'Modification and tests done!' }
    ];

    mockNio.outputs = []; // clear outputs
    await agent.processMessage('modify file and run tests');
    const finalTestWarning = mockNio.outputs.filter(o => o.includes('Heuristic Alert: Files modified but no test commands executed'));
    expect(finalTestWarning.length).toBe(0); // cleared because tests ran!
  });
});
