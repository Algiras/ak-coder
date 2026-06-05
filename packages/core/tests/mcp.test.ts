import { describe, it, expect, afterAll } from 'bun:test';
import { McpClient } from '../src/mcp';
import { MockLogger } from '../src/mocks';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('McpClient Process Integration', () => {
  const mockServerPath = path.join(__dirname, 'mock_server.js');
  const mockLogger = new MockLogger();

  // Create a minimal mock MCP server script
  const mockServerCode = `
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    rl.on('line', (line) => {
      try {
        const req = JSON.parse(line);
        if (req.method === 'initialize') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: req.id,
            result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'mock', version: '1.0' } }
          }) + '\\n');
        } else if (req.method === 'tools/list') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: req.id,
            result: {
              tools: [
                { name: 'mock_tool', description: 'A mock test tool', inputSchema: { type: 'object', properties: {} } }
              ]
            }
          }) + '\\n');
        } else if (req.method === 'tools/call') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: req.id,
            result: { content: [{ type: 'text', text: 'Tool output: Success' }] }
          }) + '\\n');
        }
      } catch (e) {
        process.stderr.write('Error: ' + e.message + '\\n');
      }
    });
  `;

  afterAll(async () => {
    await fs.unlink(mockServerPath).catch(() => {});
  });

  it('should start, handshake, list tools, call tool, and stop successfully', async () => {
    await fs.writeFile(mockServerPath, mockServerCode);

    const client = new McpClient('mock-server', 'node', [mockServerPath], mockLogger);
    await client.start();

    // Verify list tools
    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('mock_tool');

    // Verify call tool
    const result = await client.callTool('mock_tool', {});
    expect(result.content[0].text).toBe('Tool output: Success');

    await client.stop();
  });

  it('should pass outputSchema through from server tool listing', async () => {
    const serverWithOutputSchema = `
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin, terminal: false });
      rl.on('line', (line) => {
        try {
          const req = JSON.parse(line);
          if (req.method === 'initialize') {
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id,
              result: { protocolVersion: '2024-11-05', capabilities: {} } }) + '\\n');
          } else if (req.method === 'tools/list') {
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id,
              result: { tools: [{
                name: 'typed_tool',
                description: 'Has output schema',
                inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
                outputSchema: { type: 'object', properties: { answer: { type: 'string' } }, description: 'The answer' }
              }] }
            }) + '\\n');
          }
        } catch (e) {}
      });
    `;
    const serverPath = path.join(__dirname, 'mock_server_schema.js');
    await fs.writeFile(serverPath, serverWithOutputSchema);

    const client = new McpClient('schema-server', 'node', [serverPath], mockLogger);
    await client.start();

    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].outputSchema).toBeDefined();
    expect(tools[0].outputSchema?.type).toBe('object');
    expect(tools[0].outputSchema?.properties?.answer).toBeDefined();

    await client.stop();
    await fs.unlink(serverPath).catch(() => {});
  });
});

describe('AgentCore loadPlugins', () => {
  it('discovers plugin.json and exposes plugin tools via MCP client', async () => {
    const pluginServerCode = `
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin, terminal: false });
      rl.on('line', (line) => {
        try {
          const req = JSON.parse(line);
          if (req.method === 'initialize') {
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id,
              result: { protocolVersion: '2024-11-05', capabilities: {} } }) + '\\n');
          } else if (req.method === 'tools/list') {
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id,
              result: { tools: [{ name: 'plugin_action', description: 'Plugin tool', inputSchema: { type: 'object', properties: {} } }] }
            }) + '\\n');
          } else if (req.method === 'tools/call') {
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id,
              result: { content: [{ type: 'text', text: 'plugin-result' }] }
            }) + '\\n');
          }
        } catch (e) {}
      });
    `;

    const { AgentCore } = await import('../src/agent');
    const { MockFileSystem, MockSessionStore, MockLogger, MockTerminalIo } = await import('../src/mocks');
    const { MockLlmService } = await import('../src/mocks');

    const serverScriptPath = path.join(__dirname, 'mock_plugin_server.js');
    await fs.writeFile(serverScriptPath, pluginServerCode);

    const mockFs = new MockFileSystem();
    const pluginsDir = '/plugins';
    mockFs.files.set(`${pluginsDir}/my-plugin/plugin.json`, JSON.stringify({
      name: 'my-plugin',
      command: 'node',
      args: [serverScriptPath]
    }));

    const mockStore = new MockSessionStore();
    const mockLogger = new MockLogger();
    const mockNio = new MockTerminalIo();
    const mockLlm = new MockLlmService();

    const agent = new AgentCore(mockFs, mockLlm, mockStore, mockLogger, undefined, mockNio, '/workspace');
    await agent.loadPlugins(pluginsDir);

    // After loading, the plugin tool should appear in the combined tool list
    const tools = await (agent as any).getCombinedToolsList();
    const toolNames: string[] = tools.map((t: any) => t.function.name);
    expect(toolNames).toContain('my-plugin__plugin_action');

    await agent.stopMcpServers();
    await fs.unlink(serverScriptPath).catch(() => {});
  });
});
