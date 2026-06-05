import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { OpenAICompatibleLLMService } from '../src/adapters/llm';

describe('OpenAICompatibleLLMService fetch adapter', () => {
  let originalFetch: any;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should call fetch and parse chat response successfully', async () => {
    globalThis.fetch = (async (url: string, options: any) => {
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(options.method).toBe('POST');
      const body = JSON.parse(options.body);
      expect(body.model).toBe('gpt-4o');
      expect(body.stream).toBe(false);

      return new Response(JSON.stringify({
        choices: [
          { message: { content: 'Custom response content' } }
        ]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const service = new OpenAICompatibleLLMService('test-key');
    const result = await service.chat([{ role: 'user', content: 'test prompt' }]);

    expect(result.text).toBe('Custom response content');
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
  });
});
