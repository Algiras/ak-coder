import { describe, it, expect } from 'bun:test';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Piped Stdin One-Shot Mode', () => {
  it('should read stdin, query the LLM, and print the response to stdout', async () => {
    // Create an empty temporary directory for HOME
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-test-home-'));

    // 1. Start a local mock LLM server
    const server = Bun.serve({
      port: 0, // pick an ephemeral port
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.endsWith('/chat/completions')) {
          const body = await req.json() as any;
          // Retrieve the user message content
          const userMsg = body.messages.find((m: any) => m.role === 'user')?.content || '';
          
          return Response.json({
            choices: [{
              message: {
                role: 'assistant',
                content: `Processed Prompt with Stdin: ${userMsg}`
              }
            }],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 15
            }
          });
        }
        return new Response('Not Found', { status: 404 });
      }
    });

    // 2. Spawn the CLI in non-interactive piping mode
    const cliPath = 'src/index.ts';
    const child = spawn('bun', ['run', cliPath, 'Test Prompt'], {
      cwd: '/Users/algimantask/Personal/ak-coder/apps/cli',
      env: {
        ...process.env,
        HOME: tempHome,
        USERPROFILE: tempHome, // for Windows compatibility
        OPENAI_API_KEY: 'test-key',
        OPENAI_API_BASE: `http://${server.hostname}:${server.port}/v1`,
      }
    });

    // Write to child stdin
    child.stdin.write('Input Context Data');
    child.stdin.end();

    // Collect stdout
    let stdout = '';
    for await (const chunk of child.stdout) {
      stdout += chunk.toString();
    }

    // Stop the server and clean up
    server.stop();
    try {
      fs.rmSync(tempHome, { recursive: true, force: true });
    } catch {}

    // Assertions
    expect(stdout).toContain('Processed Prompt with Stdin:');
    expect(stdout).toContain('Input Context Data');
    expect(stdout).toContain('Test Prompt');
  });
});
