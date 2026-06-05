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
});
