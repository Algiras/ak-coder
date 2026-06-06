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
    expect(toolNames).toContain('bash');
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
            function: { name: 'bash', arguments: JSON.stringify({ command: 'ls' }) }
          }
        ]
      },
      { text: 'Done listing files!' }
    ];

    let result = await agent.processMessage('list files');
    expect(result.text).toBe('Done listing files!');
    expect(mockNio.outputs).toHaveLength(1); // just loader warning
    expect(mockNio.confirmResults).toHaveLength(0); // no safety confirm prompted

    // Scenario 2: Unsafe command rejected by user
    mockNio.confirmResults = [{ approved: false, applyToAll: false }]; // user rejects unsafe command
    mockLlm.responses = [
      {
        text: 'Let me destroy everything',
        tool_calls: [
          {
            id: 'call_rm',
            type: 'function',
            function: { name: 'bash', arguments: JSON.stringify({ command: 'rm -rf src/' }) }
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
    mockNio.confirmResults = [{ approved: true, applyToAll: false }]; // confirm file write

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
    mockNio.confirmResults = [{ approved: true, applyToAll: false }]; // confirm writing
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
    // confirm write_file, then approve bun test without saving pattern
    mockNio.confirmResults = [
      { approved: true, applyToAll: false },
      { approved: true, applyToAll: false }
    ];
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
            function: { name: 'bash', arguments: JSON.stringify({ command: 'bun test' }) }
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

  it('grep_search: finds matches and skips node_modules', async () => {
    // No processRunner → uses in-process fallback scan (rg path tested in integration)
    const agent = new AgentCore(mockFs, mockLlm, mockStore, mockLogger, undefined, mockNio, workspaceRoot);
    await agent.startSession('test-session-grep');

    await mockFs.writeFile('/workspace/src/app.ts', 'const greeting = "hello world";\nexport default greeting;');
    await mockFs.writeFile('/workspace/src/util.ts', 'export function add(a: number, b: number) { return a + b; }');
    await mockFs.writeFile('/workspace/node_modules/lib/index.ts', 'const hello = "should be skipped";');

    mockLlm.responses = [
      {
        text: 'Let me search',
        tool_calls: [
          {
            id: 'grep_1',
            type: 'function',
            function: { name: 'grep_search', arguments: JSON.stringify({ pattern: 'hello', path: '/workspace' }) }
          }
        ]
      },
      { text: 'Search complete' }
    ];

    await agent.processMessage('find hello');
    const toolMsgs = agent.getMessages().filter(m => m.role === 'tool');
    const grepResult = toolMsgs[0]?.content || '';

    // Should find hello in app.ts
    expect(grepResult).toContain('app.ts');
    // Should not include node_modules result
    expect(grepResult).not.toContain('node_modules');
  });

  it('grep_search: returns no-matches message when pattern not found', async () => {
    const agent = new AgentCore(mockFs, mockLlm, mockStore, mockLogger, undefined, mockNio, workspaceRoot);
    await agent.startSession('test-session-grep-nomatch');

    await mockFs.writeFile('/workspace/src/app.ts', 'const x = 1;');

    mockLlm.responses = [
      {
        text: 'Search',
        tool_calls: [
          {
            id: 'grep_nomatch',
            type: 'function',
            function: { name: 'grep_search', arguments: JSON.stringify({ pattern: 'zzznotfound', path: '/workspace' }) }
          }
        ]
      },
      { text: 'Nothing found' }
    ];

    await agent.processMessage('find nonexistent');
    const toolMsgs = agent.getMessages().filter(m => m.role === 'tool');
    expect(toolMsgs[0]?.content).toContain('No matches found');
  });

  it('glob: finds files matching pattern via in-process fallback', async () => {
    const agent = new AgentCore(mockFs, mockLlm, mockStore, mockLogger, undefined, mockNio, workspaceRoot);
    await agent.startSession('test-glob');
    mockFs.files.set('/workspace/src/app.ts', 'x');
    mockFs.files.set('/workspace/src/util.ts', 'x');
    mockFs.files.set('/workspace/src/app.test.ts', 'x');
    mockFs.files.set('/workspace/README.md', 'x');

    mockLlm.responses = [
      { text: 'Globbing', tool_calls: [
        { id: 'g1', type: 'function', function: { name: 'glob', arguments: JSON.stringify({ pattern: '**/*.ts' }) } }
      ]},
      { text: 'Done' }
    ];

    await agent.processMessage('find ts files');
    const toolMsgs = agent.getMessages().filter(m => m.role === 'tool');
    expect(toolMsgs[0]?.content).toContain('app.ts');
    expect(toolMsgs[0]?.content).toContain('util.ts');
    expect(toolMsgs[0]?.content).not.toContain('README.md');
  });

  it('str_replace: replaces a string in a read file', async () => {
    const agent = new AgentCore(mockFs, mockLlm, mockStore, mockLogger, undefined, mockNio, workspaceRoot);
    await agent.startSession('test-str-replace');
    mockFs.files.set('/workspace/hello.ts', 'export const greeting = "hello";\n');
    mockNio.confirmResults = [{ approved: true, applyToAll: false }];

    mockLlm.responses = [
      { text: 'Reading', tool_calls: [
        { id: 'r1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: '/workspace/hello.ts' }) } }
      ]},
      { text: 'Replacing', tool_calls: [
        { id: 's1', type: 'function', function: { name: 'str_replace', arguments: JSON.stringify({
          path: '/workspace/hello.ts',
          old_string: '"hello"',
          new_string: '"world"'
        }) } }
      ]},
      { text: 'Done' }
    ];

    await agent.processMessage('replace greeting');
    expect(mockFs.files.get('/workspace/hello.ts')).toContain('"world"');
  });

  it('str_replace: rejected without prior read', async () => {
    const agent = new AgentCore(mockFs, mockLlm, mockStore, mockLogger, undefined, mockNio, workspaceRoot);
    await agent.startSession('test-str-replace-lock');
    mockFs.files.set('/workspace/hello.ts', 'export const x = 1;\n');

    mockLlm.responses = [
      { text: 'Replacing without read', tool_calls: [
        { id: 's1', type: 'function', function: { name: 'str_replace', arguments: JSON.stringify({
          path: '/workspace/hello.ts',
          old_string: 'const x = 1',
          new_string: 'const x = 2'
        }) } }
      ]},
      { text: 'Done' }
    ];

    await agent.processMessage('replace without read');
    const toolMsgs = agent.getMessages().filter(m => m.role === 'tool');
    expect(toolMsgs[0]?.content).toContain('must read');
    expect(mockFs.files.get('/workspace/hello.ts')).toContain('const x = 1');
  });

  it('forkSession: forks current session and loads forked messages', async () => {
    const agent = new AgentCore(mockFs, mockLlm, mockStore, mockLogger, undefined, mockNio, workspaceRoot);
    await agent.startSession('orig');
    mockLlm.responses = [{ text: 'Reply 1' }, { text: 'Reply 2' }];
    await agent.processMessage('Turn 1');
    await agent.processMessage('Turn 2');

    const forkedId = await agent.forkSession(1);
    expect(forkedId).toMatch(/^fork-orig-/);

    // The forked session in the store should have messages up to turn index 1
    const forked = await mockStore.loadSession(forkedId);
    expect(forked.length).toBe(2); // user + assistant for turn 1
  });

  it('listSessions: returns sessions from store', async () => {
    const agent = new AgentCore(mockFs, mockLlm, mockStore, mockLogger, undefined, mockNio, workspaceRoot);
    mockStore.sessions.set('sess-a', []);
    mockStore.sessions.set('sess-b', []);
    const list = await agent.listSessions();
    const ids = list.map(s => s.sessionId);
    expect(ids).toContain('sess-a');
    expect(ids).toContain('sess-b');
  });

  it('outputSchema: warns via logger when tool output fails schema validation', async () => {
    const { z } = await import('zod');
    const agent = new AgentCore(mockFs, mockLlm, mockStore, mockLogger, undefined, mockNio, workspaceRoot);

    // Register a custom core tool whose outputSchema expects a JSON object but handler returns plain text
    (agent as any).coreTools.set('strict_tool', {
      name: 'strict_tool',
      description: 'Tool with strict output schema',
      schema: z.object({ input: z.string() }),
      outputSchema: z.object({ result: z.string() }), // expects JSON object, but handler returns plain string
      handler: async (_args: any) => 'plain text output — not JSON'
    });

    await agent.startSession('test-output-schema');

    mockLlm.responses = [
      {
        text: 'Calling strict tool',
        tool_calls: [
          {
            id: 'st1', type: 'function',
            function: { name: 'strict_tool', arguments: JSON.stringify({ input: 'test' }) }
          }
        ]
      },
      { text: 'Done' }
    ];

    await agent.processMessage('run strict tool');

    const warnLogs = mockLogger.logs.filter(l => l.level === 'warn' && l.message.includes('strict_tool'));
    expect(warnLogs.length).toBeGreaterThan(0);
    expect(warnLogs[0].message).toContain('output failed schema validation');
  });

  it('outputSchema: no warning when tool output passes schema validation', async () => {
    const { z } = await import('zod');
    const agent = new AgentCore(mockFs, mockLlm, mockStore, mockLogger, undefined, mockNio, workspaceRoot);

    (agent as any).coreTools.set('valid_tool', {
      name: 'valid_tool',
      description: 'Tool with valid output',
      schema: z.object({ input: z.string() }),
      outputSchema: z.string(), // plain string is fine
      handler: async (_args: any) => 'valid output'
    });

    await agent.startSession('test-output-schema-ok');

    mockLlm.responses = [
      {
        text: 'Calling valid tool',
        tool_calls: [
          {
            id: 'vt1', type: 'function',
            function: { name: 'valid_tool', arguments: JSON.stringify({ input: 'hi' }) }
          }
        ]
      },
      { text: 'Done' }
    ];

    await agent.processMessage('run valid tool');

    const warnLogs = mockLogger.logs.filter(l => l.level === 'warn' && l.message.includes('valid_tool'));
    expect(warnLogs.length).toBe(0);
  });

  it('web_fetch: returns page content with mocked fetch', async () => {
    const agent = new AgentCore(mockFs, mockLlm, mockStore, mockLogger, undefined, mockNio, workspaceRoot);
    await agent.startSession('test-web-fetch');

    // Intercept global fetch
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: any, _opts: any) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: (h: string) => h === 'content-type' ? 'text/plain' : null },
      text: async () => 'Hello from mock page'
    }) as any;

    mockLlm.responses = [
      {
        text: 'Fetching',
        tool_calls: [
          {
            id: 'wf1', type: 'function',
            function: { name: 'web_fetch', arguments: JSON.stringify({ url: 'https://example.com' }) }
          }
        ]
      },
      { text: 'Fetched' }
    ];

    await agent.processMessage('fetch example.com');

    globalThis.fetch = originalFetch;

    const toolMsgs = agent.getMessages().filter(m => m.role === 'tool');
    expect(toolMsgs[0]?.content).toContain('Hello from mock page');
  });

  it('web_fetch: returns error message on fetch failure', async () => {
    const agent = new AgentCore(mockFs, mockLlm, mockStore, mockLogger, undefined, mockNio, workspaceRoot);
    await agent.startSession('test-web-fetch-err');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('Network timeout'); };

    mockLlm.responses = [
      {
        text: 'Fetching bad url',
        tool_calls: [
          {
            id: 'wf2', type: 'function',
            function: { name: 'web_fetch', arguments: JSON.stringify({ url: 'https://bad.host' }) }
          }
        ]
      },
      { text: 'Failed' }
    ];

    await agent.processMessage('fetch bad host');
    globalThis.fetch = originalFetch;

    const toolMsgs = agent.getMessages().filter(m => m.role === 'tool');
    expect(toolMsgs[0]?.content).toContain('Error fetching');
    expect(toolMsgs[0]?.content).toContain('Network timeout');
  });
});
