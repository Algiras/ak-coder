import { LLMService, ChatMessage, StreamCallback } from '../ports';
import { ChannelStreamParser, stripChannelMarkers } from './stream-channels';
import { appendStreamDelta } from './stream-delta';

function extractThinkingFromDelta(delta: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ['reasoning', 'reasoning_content', 'thinking'] as const) {
    const value = delta[key];
    if (typeof value === 'string' && value) parts.push(value);
  }
  const details = delta.reasoning_details;
  if (Array.isArray(details)) {
    for (const item of details) {
      if (item && typeof item === 'object' && typeof (item as { text?: string }).text === 'string') {
        const text = (item as { text: string }).text;
        if (text) parts.push(text);
      }
    }
  }
  return parts.join('');
}

function extractThinkingFromMessage(message: Record<string, unknown>): string {
  return extractThinkingFromDelta(message);
}

function emitStreamChunk(stream: StreamCallback | undefined, type: 'content' | 'thinking', text: string): void {
  if (!text || !stream) return;
  stream({ type, text });
}

function emitContentChunk(
  stream: StreamCallback | undefined,
  parser: ChannelStreamParser,
  chunk: string,
  onThinking: (text: string) => void,
  onContent: (text: string) => void
): void {
  if (!chunk) return;
  parser.feed(chunk, (type, text) => {
    if (type === 'thinking') {
      onThinking(text);
      emitStreamChunk(stream, 'thinking', text);
    } else {
      onContent(text);
      emitStreamChunk(stream, 'content', text);
    }
  });
}

export class OpenAICompatibleLLMService implements LLMService {
  constructor(
    private apiKey: string,
    private baseUrl: string = 'https://api.openai.com/v1',
    public defaultModel: string = 'gpt-4o'
  ) {}

  // Basic estimation: 1 token approx 4 characters.
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private applyProviderOptions(body: Record<string, unknown>): void {
    const base = this.baseUrl.toLowerCase();
    if (base.includes('openrouter.ai')) {
      body.include_reasoning = true;
    }
    if (base.includes('11434') || base.includes('ollama')) {
      body.think = true;
    }
  }

  async chat(
    messages: ChatMessage[],
    options?: {
      stream?: StreamCallback;
      signal?: AbortSignal;
      tools?: any[];
    }
  ): Promise<{ text: string; thinking?: string; inputTokens: number; outputTokens: number; tool_calls?: any[] }> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`
    };

    const formattedMessages = messages.map(m => {
      const msg: any = { role: m.role };
      if (m.role === 'tool') {
        msg.tool_call_id = m.tool_call_id;
        msg.name = m.name;
        msg.content = m.content;
        return msg;
      }
      if (m.tool_calls && m.tool_calls.length > 0) {
        msg.tool_calls = m.tool_calls;
      }
      if (m.images && m.images.length > 0) {
        // Construct multimodal format for OpenAI compatibility
        const contentArray: any[] = [{ type: 'text', text: m.content }];
        for (const img of m.images) {
          contentArray.push({
            type: 'image_url',
            image_url: { url: img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}` }
          });
        }
        msg.content = contentArray;
      } else {
        msg.content = m.content;
      }
      return msg;
    });

    const body: any = {
      model: this.defaultModel,
      messages: formattedMessages,
      stream: !!options?.stream
    };
    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools;
    }
    this.applyProviderOptions(body);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options?.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API returned status ${response.status}: ${errorText}`);
    }

    let text = '';
    let thinking = '';
    let rawContent = '';
    let tool_calls: any[] = [];
    const channelParser = new ChannelStreamParser();

    if (options?.stream && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        if (options?.signal?.aborted) {
          await reader.cancel().catch(() => {});
          throw new DOMException('Interrupted', 'AbortError');
        }
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const cleanLine = line.trim();
          if (!cleanLine) continue;
          if (cleanLine === 'data: [DONE]') continue;
          if (cleanLine.startsWith('data: ')) {
            try {
              const json = JSON.parse(cleanLine.slice(6));
              const choice = json.choices?.[0];
              const delta = choice?.delta ?? {};
              const thinkingChunk = extractThinkingFromDelta(delta);
              if (thinkingChunk) {
                const merged = appendStreamDelta(thinking, thinkingChunk);
                thinking = merged.value;
                if (merged.delta) emitStreamChunk(options.stream, 'thinking', merged.delta);
              }
              const chunk = delta.content || '';
              if (chunk) {
                const merged = appendStreamDelta(rawContent, chunk);
                rawContent = merged.value;
                if (merged.delta) {
                  emitContentChunk(
                    options.stream,
                    channelParser,
                    merged.delta,
                    (part) => { thinking += part; },
                    (part) => { text += part; }
                  );
                }
              }
              const tcChunk = delta.tool_calls;
              if (tcChunk) {
                for (const tc of tcChunk) {
                  const idx = tc.index;
                  if (!tool_calls[idx]) {
                    tool_calls[idx] = {
                      id: tc.id || '',
                      type: tc.type || 'function',
                      function: { name: tc.function?.name || '', arguments: '' }
                    };
                  } else {
                    if (tc.id) tool_calls[idx].id = tc.id;
                    if (tc.type) tool_calls[idx].type = tc.type;
                    if (tc.function?.name) tool_calls[idx].function.name = tc.function.name;
                  }
                  if (tc.function?.arguments) {
                    tool_calls[idx].function.arguments += tc.function.arguments;
                  }
                }
              }
            } catch {
              // Ignore partial JSON parse errors
            }
          }
        }
      }
      channelParser.flush((type, textPart) => {
        if (type === 'thinking') {
          thinking += textPart;
          emitStreamChunk(options.stream, 'thinking', textPart);
        } else {
          text += textPart;
          emitStreamChunk(options.stream, 'content', textPart);
        }
      });
    } else {
      const data = await response.json() as any;
      const message = data.choices?.[0]?.message ?? {};
      text = message.content || '';
      thinking = extractThinkingFromMessage(message);
      if (thinking) emitStreamChunk(options?.stream, 'thinking', thinking);
      const stripped = stripChannelMarkers(text);
      if (stripped.thinking) {
        thinking = thinking ? `${thinking}${stripped.thinking}` : stripped.thinking;
        if (options?.stream) emitStreamChunk(options.stream, 'thinking', stripped.thinking);
      }
      text = stripped.content;
      if (text) emitStreamChunk(options?.stream, 'content', text);
      tool_calls = message.tool_calls || [];
    }

    const inputString = messages.map(m => m.content).join(' ');
    const inputTokens = this.estimateTokens(inputString);
    const outputTokens = this.estimateTokens(text + thinking);
    const cleanedToolCalls = tool_calls.filter(Boolean);

    return {
      text,
      thinking: thinking || undefined,
      inputTokens,
      outputTokens,
      tool_calls: cleanedToolCalls.length > 0 ? cleanedToolCalls : undefined
    };
  }
}
