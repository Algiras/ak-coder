import { AgentCore } from '@ak-coder/core';
import * as readline from 'readline';

export class StdioJsonRpcAdapter {
  private messageId = 0;

  constructor(private agent: AgentCore) {}

  start(): void {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    // Write diagnostic logs to stderr so stdout is strictly JSON-RPC
    process.stderr.write('[ak-coder stdio agent server started]\n');

    rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const req = JSON.parse(trimmed);
        if (req.method === 'sendMessage') {
          const prompt = req.params?.prompt || '';
          const images = req.params?.images || [];
          const requestId = req.id;

          try {
            const result = await this.agent.processMessage(prompt, images, (chunk) => {
              // Send stream notification chunk
              this.sendNotification('message/stream', { chunk, requestId });
            });
            this.sendResponse(requestId, result);
          } catch (e) {
            this.sendError(requestId, -32000, (e as Error).message);
          }
        } else if (req.method === 'addFile') {
          const filePath = req.params?.filePath;
          try {
            await this.agent.addFileToContext(filePath);
            this.sendResponse(req.id, { success: true });
          } catch (e) {
            this.sendError(req.id, -32000, (e as Error).message);
          }
        } else if (req.method === 'removeFile') {
          const filePath = req.params?.filePath;
          this.agent.removeFileFromContext(filePath);
          this.sendResponse(req.id, { success: true });
        } else if (req.method === 'getContext') {
          this.sendResponse(req.id, {
            activeFiles: this.agent.getActiveFiles(),
            summary: this.agent.getContextSummary(),
            messages: this.agent.getMessages()
          });
        } else if (req.method === 'ping') {
          this.sendResponse(req.id, { status: 'pong' });
        } else {
          this.sendError(req.id, -32601, `Method "${req.method}" not found.`);
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

  private sendNotification(method: string, params: any): void {
    const payload = {
      jsonrpc: '2.0',
      method,
      params
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
