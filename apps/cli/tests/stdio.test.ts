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

// Helper: feed JSON-RPC requests into a started adapter and collect stdout lines
function makeHarness(agent: AgentCore) {
  const stdoutLines: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: any, ...args: any[]) => {
    stdoutLines.push(chunk.toString());
    return true;
  };

  const mockStdin = new Readable({ read() {} });
  const originalStdin = process.stdin;

  // Patch process.stdin so the adapter's readline picks up our mock
  (process as any).stdin = mockStdin;

  const adapter = new StdioJsonRpcAdapter(agent);
  adapter.start();

  async function send(req: object): Promise<object> {
    const before = stdoutLines.length;
    mockStdin.push(JSON.stringify(req) + '\n');
    // Wait for the response line to arrive
    await new Promise<void>((resolve) => {
      const check = () => {
        if (stdoutLines.length > before) return resolve();
        setTimeout(check, 5);
      };
      check();
    });
    const raw = stdoutLines[stdoutLines.length - 1].trim();
    return JSON.parse(raw);
  }

  function restore() {
    process.stdout.write = originalWrite;
    (process as any).stdin = originalStdin;
    mockStdin.push(null);
  }

  return { send, stdoutLines, restore };
}

describe('StdioJsonRpcAdapter — real adapter coverage', () => {
  let mockFs: MockFileSystem;
  let mockLlm: MockLlmService;
  let mockStore: MockSessionStore;
  let mockLogger: MockLogger;
  let agent: AgentCore;

  beforeEach(async () => {
    mockFs = new MockFileSystem();
    mockLlm = new MockLlmService();
    mockStore = new MockSessionStore();
    mockLogger = new MockLogger();
    agent = new AgentCore(mockFs, mockLlm, mockStore, mockLogger);
    await agent.startSession('stdio-test');
  });

  it('ping → {status: pong}', async () => {
    const { send, restore } = makeHarness(agent);
    const res = await send({ jsonrpc: '2.0', id: 1, method: 'ping' }) as any;
    restore();
    expect(res.jsonrpc).toBe('2.0');
    expect(res.id).toBe(1);
    expect(res.result.status).toBe('pong');
  });

  it('addFile → success; getContext returns file; removeFile removes it', async () => {
    await mockFs.writeFile('/src/main.ts', 'export {}');
    const { send, restore } = makeHarness(agent);

    const addRes = await send({ jsonrpc: '2.0', id: 2, method: 'addFile', params: { filePath: '/src/main.ts' } }) as any;
    expect(addRes.result.success).toBe(true);

    const ctxRes = await send({ jsonrpc: '2.0', id: 3, method: 'getContext' }) as any;
    expect(ctxRes.result.activeFiles).toContain('/src/main.ts');

    const rmRes = await send({ jsonrpc: '2.0', id: 4, method: 'removeFile', params: { filePath: '/src/main.ts' } }) as any;
    expect(rmRes.result.success).toBe(true);

    const ctxAfter = await send({ jsonrpc: '2.0', id: 5, method: 'getContext' }) as any;
    expect(ctxAfter.result.activeFiles).not.toContain('/src/main.ts');

    restore();
  });

  it('sendMessage → receives final result with text', async () => {
    mockLlm.mockResponse = 'Hello from LLM';
    const { send, stdoutLines, restore } = makeHarness(agent);

    const before = stdoutLines.length;
    const res = await send({ jsonrpc: '2.0', id: 10, method: 'sendMessage', params: { prompt: 'Say hello' } }) as any;
    restore();

    expect(res.id).toBe(10);
    expect(res.result).toBeDefined();
    expect(res.result.text).toBe('Hello from LLM');
  });

  it('addFile with missing file → error response -32000', async () => {
    const { send, restore } = makeHarness(agent);
    const res = await send({ jsonrpc: '2.0', id: 20, method: 'addFile', params: { filePath: '/no/such/file.ts' } }) as any;
    restore();
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(-32000);
  });

  it('unknown method → error -32601', async () => {
    const { send, restore } = makeHarness(agent);
    const res = await send({ jsonrpc: '2.0', id: 30, method: 'unknownMethod' }) as any;
    restore();
    expect(res.error.code).toBe(-32601);
  });

  it('malformed JSON → parse error -32700 with id null', async () => {
    const stdoutLines: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: any, ...args: any[]) => {
      stdoutLines.push(chunk.toString());
      return true;
    };

    const mockStdin = new Readable({ read() {} });
    const originalStdin = process.stdin;
    (process as any).stdin = mockStdin;

    const adapter2 = new StdioJsonRpcAdapter(agent);
    adapter2.start();

    mockStdin.push('{not valid json}\n');
    await new Promise<void>((resolve) => {
      const check = () => {
        if (stdoutLines.length > 0) return resolve();
        setTimeout(check, 5);
      };
      check();
    });

    process.stdout.write = originalWrite;
    (process as any).stdin = originalStdin;
    mockStdin.push(null);

    const parsed = JSON.parse(stdoutLines[0].trim()) as any;
    expect(parsed.error.code).toBe(-32700);
    expect(parsed.id).toBeNull();
  });
});
