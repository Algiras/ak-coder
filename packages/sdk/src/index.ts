import * as readline from 'readline';
import { z } from 'zod';
import { ToolDefinition } from './types';
import { zodToJsonSchema } from './zod-to-json-schema';

export * from './types';
export * from './zod-to-json-schema';

export class PluginSDK {
  private tools = new Map<string, ToolDefinition>();

  constructor() {
    // Safety check: redirect console.log to stderr so it does not corrupt the JSON-RPC stdout stream
    console.log = (...args: any[]) => {
      console.error('[Console.log redirected to stderr]', ...args);
    };
  }

  registerTool<TSchema extends z.ZodObject<any>>(tool: ToolDefinition<TSchema>): void {
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
          const toolSchemas = this.buildToolSchemas();
          this.sendResponse(req.id, { tools: toolSchemas, protocolVersion: '2024-11-05', capabilities: {} });
        } else if (req.method === 'notifications/initialized') {
          // No-op: MCP client sends this after initialize
        } else if (req.method === 'tools/list') {
          this.sendResponse(req.id, { tools: this.buildToolSchemas() });
        } else if (req.method === 'tools/call') {
          const toolName = req.params?.name;
          const args = req.params?.arguments || {};
          const tool = this.tools.get(toolName);

          if (!tool) {
            this.sendError(req.id, -32601, `Tool "${toolName}" not found.`);
            return;
          }

          const parsedArgs = tool.schema.safeParse(args);
          if (!parsedArgs.success) {
            const formattedErrors = parsedArgs.error.issues
              .map(e => `${e.path.join('.')}: ${e.message}`)
              .join(', ');
            this.sendError(req.id, -32602, `Invalid params: ${formattedErrors}`);
            return;
          }

          try {
            const result = await tool.handler(parsedArgs.data);
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

  private buildToolSchemas() {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.schema),
      ...(t.outputSchema ? { outputSchema: zodToJsonSchema(t.outputSchema) } : {})
    }));
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
