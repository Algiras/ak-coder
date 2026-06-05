import { spawn, ChildProcess } from 'child_process';
import { Logger } from './ports';

export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, any>;
    required?: string[];
  };
  outputSchema?: {
    type: 'object';
    properties?: Record<string, any>;
    required?: string[];
    description?: string;
  };
}

export class McpClient {
  private process: ChildProcess | null = null;
  private messageId = 0;
  private pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: Error) => void }>();
  private stdoutBuffer = '';

  constructor(
    private serverName: string,
    private command: string,
    private args: string[],
    private logger: Logger
  ) {}

  async start(): Promise<void> {
    this.logger.info(`Starting MCP server "${this.serverName}": ${this.command} ${this.args.join(' ')}`);
    
    this.process = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.process.stdout?.on('data', (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString();
      const lines = this.stdoutBuffer.split('\n');
      this.stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        this.handleMessage(line);
      }
    });

    this.process.stderr?.on('data', (chunk: Buffer) => {
      this.logger.warn(`MCP Server [${this.serverName}] stderr: ${chunk.toString().trim()}`);
    });

    this.process.on('close', (code) => {
      this.logger.info(`MCP Server [${this.serverName}] exited with code ${code}`);
      this.rejectAllPending(new Error(`MCP server [${this.serverName}] exited with code ${code}`));
    });

    // Run initialize handshake
    await this.initialize();
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  private handleMessage(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.id !== undefined) {
        const handler = this.pendingRequests.get(parsed.id);
        if (handler) {
          this.pendingRequests.delete(parsed.id);
          if (parsed.error) {
            handler.reject(new Error(parsed.error.message || 'Unknown MCP error'));
          } else {
            handler.resolve(parsed.result);
          }
        }
      }
    } catch {
      // Ignore unparseable stdout lines
    }
  }

  private rejectAllPending(error: Error) {
    for (const [id, handler] of this.pendingRequests) {
      handler.reject(error);
    }
    this.pendingRequests.clear();
  }

  private sendRequest(method: string, params: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin) {
        return reject(new Error(`MCP server "${this.serverName}" is not running.`));
      }
      const id = ++this.messageId;
      const payload = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };
      this.pendingRequests.set(id, { resolve, reject });
      this.process.stdin.write(JSON.stringify(payload) + '\n');
    });
  }

  private async initialize(): Promise<void> {
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'ak-coder-client', version: '0.1.0' }
    });
    // Send initialized notification
    if (this.process && this.process.stdin) {
      const notification = {
        jsonrpc: '2.0',
        method: 'notifications/initialized'
      };
      this.process.stdin.write(JSON.stringify(notification) + '\n');
    }
  }

  async listTools(): Promise<McpToolSchema[]> {
    const result = await this.sendRequest('tools/list');
    return (result.tools || []) as McpToolSchema[];
  }

  async callTool(name: string, args: Record<string, any>): Promise<any> {
    const result = await this.sendRequest('tools/call', {
      name,
      arguments: args
    });
    return result;
  }
}
