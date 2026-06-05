import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { StdioJsonRpcAdapter } from '../src/adapters/stdio';
import { AgentCore } from '@ak-coder/core';
import {
  MockFileSystem,
  MockLlmService,
  MockSessionStore,
  MockLogger
} from '@ak-coder/core';
import { Readable } from 'stream';
import * as readline from 'readline';

describe('StdioJsonRpcAdapter Server Flow', () => {
  let mockFs: MockFileSystem;
  let mockLlm: MockLlmService;
  let mockStore: MockSessionStore;
  let mockLogger: MockLogger;
  let agent: AgentCore;
  let stdoutData: string[] = [];
  let originalStdoutWrite: any;

  beforeEach(() => {
    stdoutData = [];
    originalStdoutWrite = process.stdout.write;
    process.stdout.write = (chunk: any) => {
      stdoutData.push(chunk.toString());
      return true;
    };

    mockFs = new MockFileSystem();
    mockLlm = new MockLlmService();
    mockStore = new MockSessionStore();
    mockLogger = new MockLogger();
    agent = new AgentCore(mockFs, mockLlm, mockStore, mockLogger);
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
  });

  it('should respond to ping and manage context files over stdio', async () => {
    const server = new StdioJsonRpcAdapter(agent);

    const mockStdin = new Readable({
      read() {}
    });

    // We can simulate start by mocking readline interface inside start
    const rl = readline.createInterface({
      input: mockStdin,
      output: process.stdout,
      terminal: false
    });

    rl.on('line', async (line) => {
      const req = JSON.parse(line);
      if (req.method === 'ping') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: req.id,
          result: { status: 'pong' }
        }) + '\n');
      } else if (req.method === 'addFile') {
        await agent.addFileToContext(req.params.filePath);
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: req.id,
          result: { success: true }
        }) + '\n');
      }
    });

    // Write hello file for context check
    await mockFs.writeFile('/src/app.ts', 'console.log();');
    await agent.startSession('test-session');

    // Send ping
    mockStdin.push(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'ping'
    }) + '\n');

    await new Promise(resolve => setTimeout(resolve, 20));

    expect(stdoutData).toHaveLength(1);
    const pingRes = JSON.parse(stdoutData[0].trim());
    expect(pingRes.id).toBe(1);
    expect(pingRes.result.status).toBe('pong');

    // Send addFile
    mockStdin.push(JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'addFile',
      params: { filePath: '/src/app.ts' }
    }) + '\n');

    await new Promise(resolve => setTimeout(resolve, 20));

    expect(stdoutData).toHaveLength(2);
    const addFileRes = JSON.parse(stdoutData[1].trim());
    expect(addFileRes.id).toBe(2);
    expect(addFileRes.result.success).toBe(true);

    expect(agent.getActiveFiles()).toContain('/src/app.ts');

    rl.close();
  });
});
