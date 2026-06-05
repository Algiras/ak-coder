import * as readline from 'readline';

export interface ToolDefinition {
  name: string;
  description: string;
  handler: (args: any) => Promise<any> | any;
}

export class PluginSDK {
  private tools = new Map<string, ToolDefinition>();

  constructor() {
    // Safety check: redirect console.log to stderr so it does not corrupt the JSON-RPC stdout stream
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      console.error('[Console.log redirected to stderr]', ...args);
    };
  }

  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  start(): void {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const req = JSON.parse(trimmed);
        if (req.method === 'initialize') {
          const toolSchemas = Array.from(this.tools.values()).map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: { type: 'object', properties: {} } // Simplified for mock/basic plugins
          }));

          this.sendResponse(req.id, {
            tools: toolSchemas
          });
        } else if (req.method === 'tools/call') {
          const toolName = req.params?.name;
          const args = req.params?.arguments || {};
          const tool = this.tools.get(toolName);

          if (!tool) {
            this.sendError(req.id, -32601, `Tool "${toolName}" not found.`);
            return;
          }

          try {
            const result = await tool.handler(args);
            this.sendResponse(req.id, result);
          } catch (e) {
            this.sendError(req.id, -32000, (e as Error).message);
          }
        }
      } catch (e) {
        this.sendError(null, -32700, `Parse error: ${(e as Error).message}`);
      }
    });
  }

  private sendResponse(id: number | null, result: any): void {
    if (id === null) return;
    const payload = {
      jsonrpc: '2.0',
      id,
      result
    };
    process.stdout.write(JSON.stringify(payload) + '\n');
  }

  private sendError(id: number | null, code: number, message: string): void {
    const payload = {
      jsonrpc: '2.0',
      id,
      error: { code, message }
    };
    process.stdout.write(JSON.stringify(payload) + '\n');
  }
}
