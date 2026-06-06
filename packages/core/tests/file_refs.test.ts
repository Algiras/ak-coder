import { describe, it, expect, beforeEach } from 'bun:test';
import { AgentCore } from '../src/agent';
import { LLMService, ChatMessage } from '../src/ports';
import { MockFileSystem, MockSessionStore, MockLogger, MockTerminalIo } from '../src/mocks';

class SimpleMockLlm implements LLMService {
  public lastPrompt: ChatMessage[] = [];
  async chat(messages: ChatMessage[], opts?: any): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    this.lastPrompt = messages;
    return { text: 'ok', inputTokens: 5, outputTokens: 5 };
  }
}

describe('@file reference expansion', () => {
  let mockFs: MockFileSystem;
  let mockLlm: SimpleMockLlm;
  let agent: AgentCore;

  beforeEach(() => {
    mockFs = new MockFileSystem();
    mockLlm = new SimpleMockLlm();
    agent = new AgentCore(mockFs, mockLlm, new MockSessionStore(), new MockLogger(), undefined, new MockTerminalIo(), '/ws');
  });

  it('inlines file content when @token resolves to an existing file', async () => {
    mockFs.files.set('/ws/src/app.ts', 'export const x = 1;');
    await agent.startSession('test-ref');

    await agent.processMessage('look at @src/app.ts and explain it');

    const userMsg = mockLlm.lastPrompt.find(m => m.role === 'user');
    expect(userMsg?.content).toContain('<file path="src/app.ts">');
    expect(userMsg?.content).toContain('export const x = 1;');
  });

  it('leaves @token untouched when file does not exist', async () => {
    await agent.startSession('test-ref-missing');

    await agent.processMessage('the @deprecated annotation is fine');

    const userMsg = mockLlm.lastPrompt.find(m => m.role === 'user');
    expect(userMsg?.content).toContain('@deprecated');
    expect(userMsg?.content).not.toContain('<file');
  });

  it('replaces oversized file with [file too large] marker', async () => {
    const big = 'x'.repeat(101 * 1024); // > 100KB
    mockFs.files.set('/ws/dist/bundle.js', big);
    await agent.startSession('test-ref-large');

    await agent.processMessage('check @dist/bundle.js');

    const userMsg = mockLlm.lastPrompt.find(m => m.role === 'user');
    expect(userMsg?.content).toContain('[file too large: dist/bundle.js]');
    expect(userMsg?.content).not.toContain('<file');
  });

  it('expands multiple @references in the same prompt', async () => {
    mockFs.files.set('/ws/a.ts', 'const a = 1;');
    mockFs.files.set('/ws/b.ts', 'const b = 2;');
    await agent.startSession('test-ref-multi');

    await agent.processMessage('compare @a.ts and @b.ts');

    const userMsg = mockLlm.lastPrompt.find(m => m.role === 'user');
    expect(userMsg?.content).toContain('<file path="a.ts">');
    expect(userMsg?.content).toContain('<file path="b.ts">');
    expect(userMsg?.content).toContain('const a = 1;');
    expect(userMsg?.content).toContain('const b = 2;');
  });

  it('expands absolute @references', async () => {
    mockFs.files.set('/ws/config.json', '{"key":"val"}');
    await agent.startSession('test-ref-abs');

    await agent.processMessage('check @/ws/config.json');

    const userMsg = mockLlm.lastPrompt.find(m => m.role === 'user');
    expect(userMsg?.content).toContain('{"key":"val"}');
  });
});
