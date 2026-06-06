import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { PluginSDK } from '../src';
import { Readable } from 'stream';
import { z } from 'zod';

describe('PluginSDK Zod Flow', () => {
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

  it('should register tool, generate schema, and validate params using Zod', async () => {
    const sdk = new PluginSDK();
    
    // Register tool with Zod schema
    sdk.registerTool({
      name: 'greet_user',
      description: 'Greets the user with their name and age',
      schema: z.object({
        name: z.string().describe('The name of the user'),
        age: z.number().optional().describe('The age of the user')
      }),
      handler: (args) => ({
        message: `Hello ${args.name}! You are ${args.age || 'of unknown'} years old.`
      })
    });

    // Mock stdin
    const mockStdin = new Readable({
      read() {}
    });

    // Override process.stdin to use our mockStdin
    const originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', {
      value: mockStdin,
      writable: true,
      configurable: true
    });

    sdk.start();

    // 1. Test Handshake (initialize)
    mockStdin.push(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize'
    }) + '\n');

    await new Promise(resolve => setTimeout(resolve, 20));

    expect(stdoutData).toHaveLength(1);
    const initRes = JSON.parse(stdoutData[0].trim());
    expect(initRes.id).toBe(1);
    expect(initRes.result.tools[0].name).toBe('greet_user');
    
    // Check if the Zod schema was converted to JSON schema correctly
    const schema = initRes.result.tools[0].inputSchema;
    expect(schema.type).toBe('object');
    expect(schema.properties.name.type).toBe('string');
    expect(schema.properties.name.description).toBe('The name of the user');
    expect(schema.properties.age.type).toBe('number');
    expect(schema.properties.age.description).toBe('The age of the user');
    expect(schema.required).toContain('name');
    expect(schema.required).not.toContain('age');

    // 2. Test valid tool call
    mockStdin.push(JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'greet_user',
        arguments: { name: 'Alice', age: 25 }
      }
    }) + '\n');

    await new Promise(resolve => setTimeout(resolve, 20));

    expect(stdoutData).toHaveLength(2);
    const callRes = JSON.parse(stdoutData[1].trim());
    expect(callRes.id).toBe(2);
    expect(callRes.result.message).toBe('Hello Alice! You are 25 years old.');

    // 3. Test invalid tool call (fails Zod schema validation)
    mockStdin.push(JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'greet_user',
        arguments: { age: 'not-a-number' } // missing 'name', wrong type for 'age'
      }
    }) + '\n');

    await new Promise(resolve => setTimeout(resolve, 20));

    expect(stdoutData).toHaveLength(3);
    const errRes = JSON.parse(stdoutData[2].trim());
    expect(errRes.id).toBe(3);
    expect(errRes.error).toBeDefined();
    expect(errRes.error.code).toBe(-32602); // Invalid params
    expect(errRes.error.message).toContain('name'); // should complain about missing name
    expect(errRes.error.message).toContain('age');  // should complain about wrong type for age

    // Restore process.stdin
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      writable: true,
      configurable: true
    });
  });

  it('should correctly convert complex schemas (enums, arrays, nullable) to JSON schemas', async () => {
    const sdk = new PluginSDK();
    
    sdk.registerTool({
      name: 'complex_tool',
      description: 'Test complex schemas',
      schema: z.object({
        tags: z.array(z.string()).describe('List of tags'),
        status: z.enum(['active', 'inactive']).describe('Current status'),
        notes: z.string().nullable().describe('Optional notes')
      }),
      handler: () => 'ok'
    });

    const mockStdin = new Readable({ read() {} });
    const originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true, configurable: true });

    sdk.start();

    mockStdin.push(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n');
    await new Promise(resolve => setTimeout(resolve, 20));

    const res = JSON.parse(stdoutData[0].trim());
    const schema = res.result.tools[0].inputSchema;

    expect(schema.type).toBe('object');
    expect(schema.properties.tags.type).toBe('array');
    expect(schema.properties.tags.items.type).toBe('string');
    expect(schema.properties.tags.description).toBe('List of tags');
    
    expect(schema.properties.status.type).toBe('string');
    expect(schema.properties.status.enum).toEqual(['active', 'inactive']);
    expect(schema.properties.status.description).toBe('Current status');
    
    expect(schema.properties.notes.type).toBe('string');
    expect(schema.properties.notes.description).toBe('Optional notes');

    Object.defineProperty(process, 'stdin', { value: originalStdin, writable: true, configurable: true });
  });

  it('should respond to tools/list with registered tools', async () => {
    const sdk = new PluginSDK();
    sdk.registerTool({
      name: 'ping',
      description: 'Ping tool',
      schema: z.object({ msg: z.string() }),
      handler: (args) => args.msg
    });

    const mockStdin = new Readable({ read() {} });
    const originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true, configurable: true });

    sdk.start();

    mockStdin.push(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n');
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(stdoutData).toHaveLength(1);
    const res = JSON.parse(stdoutData[0].trim());
    expect(res.result.tools).toHaveLength(1);
    expect(res.result.tools[0].name).toBe('ping');

    Object.defineProperty(process, 'stdin', { value: originalStdin, writable: true, configurable: true });
  });

  it('should include outputSchema in tool listing when defined', async () => {
    const sdk = new PluginSDK();
    sdk.registerTool({
      name: 'typed_tool',
      description: 'Tool with output schema',
      schema: z.object({ input: z.string() }),
      outputSchema: z.object({ result: z.string() }),
      handler: (args) => ({ result: args.input.toUpperCase() })
    });

    const mockStdin = new Readable({ read() {} });
    const originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true, configurable: true });

    sdk.start();

    mockStdin.push(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n');
    await new Promise(resolve => setTimeout(resolve, 20));

    const res = JSON.parse(stdoutData[0].trim());
    const tool = res.result.tools[0];
    expect(tool.outputSchema).toBeDefined();
    expect(tool.outputSchema.type).toBe('object');
    expect(tool.outputSchema.properties.result).toBeDefined();

    Object.defineProperty(process, 'stdin', { value: originalStdin, writable: true, configurable: true });
  });

  it('should handle notifications/initialized without error', async () => {
    const sdk = new PluginSDK();
    const mockStdin = new Readable({ read() {} });
    const originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true, configurable: true });

    sdk.start();

    // Send a notification (no id, no response expected)
    mockStdin.push(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    await new Promise(resolve => setTimeout(resolve, 20));

    // No output should be written for notifications
    expect(stdoutData).toHaveLength(0);

    Object.defineProperty(process, 'stdin', { value: originalStdin, writable: true, configurable: true });
  });
});
