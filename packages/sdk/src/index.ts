import * as readline from 'readline';
import { z } from 'zod';

export interface ToolDefinition<TSchema extends z.ZodObject<any> = z.ZodObject<any>> {
  name: string;
  description: string;
  schema: TSchema;
  handler: (args: z.infer<TSchema>) => Promise<any> | any;
}

function zodToJsonSchema(schema: z.ZodTypeAny): any {
  const description = schema.description;

  if (schema instanceof z.ZodObject) {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    const shape = schema.shape;
    for (const [key, propSchema] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(propSchema as z.ZodTypeAny);
      if (!(propSchema instanceof z.ZodOptional) && !(propSchema instanceof z.ZodNullable)) {
        required.push(key);
      }
    }
    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {})
    };
  }

  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    const unwrappedSchema = zodToJsonSchema(schema.unwrap());
    if (description && !unwrappedSchema.description) {
      unwrappedSchema.description = description;
    }
    return unwrappedSchema;
  }

  let typeStr = 'string';

  if (schema instanceof z.ZodString) {
    typeStr = 'string';
  } else if (schema instanceof z.ZodNumber) {
    typeStr = 'number';
  } else if (schema instanceof z.ZodBoolean) {
    typeStr = 'boolean';
  } else if (schema instanceof z.ZodEnum) {
    return {
      type: 'string',
      enum: schema.options,
      ...(description ? { description } : {})
    };
  } else if (schema instanceof z.ZodArray) {
    return {
      type: 'array',
      items: zodToJsonSchema(schema.element),
      ...(description ? { description } : {})
    };
  }

  return {
    type: typeStr,
    ...(description ? { description } : {})
  };
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
          const toolSchemas = Array.from(this.tools.values()).map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: zodToJsonSchema(t.schema)
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
