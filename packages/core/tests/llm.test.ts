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

  it('should stream thinking and content chunks separately', async () => {
    const chunks: string[] = [];
    globalThis.fetch = (async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      expect(body.include_reasoning).toBe(true);

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(
            'data: {"choices":[{"delta":{"reasoning":"Step 1. "}}]}\n\n'
          ));
          controller.enqueue(new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"Answer"}}]}\n\n'
          ));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        }
      });

      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }) as any;

    const service = new OpenAICompatibleLLMService('test-key', 'https://openrouter.ai/api/v1');
    const thinking: string[] = [];
    const content: string[] = [];
    const result = await service.chat([{ role: 'user', content: 'test' }], {
      stream: (chunk) => {
        chunks.push(`${chunk.type}:${chunk.text}`);
        if (chunk.type === 'thinking') thinking.push(chunk.text);
        if (chunk.type === 'content') content.push(chunk.text);
      }
    });

    expect(thinking.join('')).toBe('Step 1. ');
    expect(content.join('')).toBe('Answer');
    expect(result.text).toBe('Answer');
    expect(result.thinking).toBe('Step 1. ');
  });

  it('should split embedded channel markers in content stream', async () => {
    globalThis.fetch = (async (_url: string, options: any) => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"Hi "}}]}\n\n'
          ));
          controller.enqueue(new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"<|channel>thought\\nCoT\\n<channel|>\\nAnswer"}}]}\n\n'
          ));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        }
      });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }) as any;

    const service = new OpenAICompatibleLLMService('test-key', 'https://openrouter.ai/api/v1');
    const thinking: string[] = [];
    const content: string[] = [];
    const result = await service.chat([{ role: 'user', content: 'test' }], {
      stream: (chunk) => {
        if (chunk.type === 'thinking') thinking.push(chunk.text);
        if (chunk.type === 'content') content.push(chunk.text);
      }
    });

    expect(thinking.join('')).toBe('CoT\n');
    expect(content.join('')).toBe('Hi Answer');
    expect(result.text).toBe('Hi Answer');
    expect(result.thinking).toBe('CoT\n');
  });

  it('should not duplicate cumulative reasoning stream chunks', async () => {
    globalThis.fetch = (async (_url: string, options: any) => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(
            'data: {"choices":[{"delta":{"reasoning":"The user"}}]}\n\n'
          ));
          controller.enqueue(new TextEncoder().encode(
            'data: {"choices":[{"delta":{"reasoning":"The user mentioned"}}]}\n\n'
          ));
          controller.enqueue(new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"Done"}}]}\n\n'
          ));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        }
      });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }) as any;

    const service = new OpenAICompatibleLLMService('test-key', 'https://openrouter.ai/api/v1');
    const thinking: string[] = [];
    const result = await service.chat([{ role: 'user', content: 'test' }], {
      stream: (chunk) => {
        if (chunk.type === 'thinking') thinking.push(chunk.text);
      }
    });

    expect(thinking.join('')).toBe('The user mentioned');
    expect(result.thinking).toBe('The user mentioned');
    expect(result.text).toBe('Done');
  });
});
