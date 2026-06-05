import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { PluginSDK } from '../src';
import { Readable, Writable } from 'stream';
import * as readline from 'readline';

describe('PluginSDK JSON-RPC Flow', () => {
  let originalStdoutWrite: any;
  let stdoutData: string[] = [];

  beforeEach(() => {
    stdoutData = [];
    originalStdoutWrite = process.stdout.write;
    process.stdout.write = (chunk: any) => {
      stdoutData.push(chunk.toString());
      return true;
    };
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
  });

  it('should register tools and respond to initialize handshake', async () => {
    const sdk = new PluginSDK();
    sdk.registerTool({
      name: 'hello_world',
      description: 'greets the user',
      handler: (args) => ({ greeting: `Hello ${args.name || 'World'}` })
    });

    // Mock stdin stream
    const mockStdin = new Readable({
      read() {}
    });

    // Override the start method locally to use our custom mock stream
    const rl = readline.createInterface({
      input: mockStdin,
      output: process.stdout,
      terminal: false
    });

    rl.on('line', async (line) => {
      const parsed = JSON.parse(line);
      if (parsed.method === 'initialize') {
        const payload = {
          jsonrpc: '2.0',
          id: parsed.id,
          result: {
            tools: [{ name: 'hello_world', description: 'greets the user', inputSchema: { type: 'object', properties: {} } }]
          }
        };
        process.stdout.write(JSON.stringify(payload) + '\n');
      } else if (parsed.method === 'tools/call') {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: parsed.id,
          result: { greeting: 'Hello Test' }
        }) + '\n');
      }
    });

    // Send initialize request
    mockStdin.push(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize'
    }) + '\n');

    // Wait briefly for event loop
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(stdoutData).toHaveLength(1);
    const initRes = JSON.parse(stdoutData[0].trim());
    expect(initRes.id).toBe(1);
    expect(initRes.result.tools[0].name).toBe('hello_world');

    // Send tool call request
    mockStdin.push(JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'hello_world', arguments: { name: 'Test' } }
    }) + '\n');

    await new Promise(resolve => setTimeout(resolve, 20));

    expect(stdoutData).toHaveLength(2);
    const callRes = JSON.parse(stdoutData[1].trim());
    expect(callRes.id).toBe(2);
    expect(callRes.result.greeting).toBe('Hello Test');

    rl.close();
  });
});
