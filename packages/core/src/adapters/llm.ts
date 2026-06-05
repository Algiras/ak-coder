import { LLMService, ChatMessage } from '../ports';

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

  async chat(
    messages: ChatMessage[],
    options?: {
      stream?: (chunk: string) => void;
      signal?: AbortSignal;
      tools?: any[];
    }
  ): Promise<{ text: string; inputTokens: number; outputTokens: number; tool_calls?: any[] }> {
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
    let tool_calls: any[] = [];

    if (options?.stream && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
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
              const chunk = choice?.delta?.content || '';
              if (chunk) {
                text += chunk;
                options.stream(chunk);
              }
              const tcChunk = choice?.delta?.tool_calls;
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
    } else {
      const data = await response.json() as any;
      text = data.choices?.[0]?.message?.content || '';
      tool_calls = data.choices?.[0]?.message?.tool_calls || [];
    }

    const inputString = messages.map(m => m.content).join(' ');
    const inputTokens = this.estimateTokens(inputString);
    const outputTokens = this.estimateTokens(text);
    const cleanedToolCalls = tool_calls.filter(Boolean);

    return {
      text,
      inputTokens,
      outputTokens,
      tool_calls: cleanedToolCalls.length > 0 ? cleanedToolCalls : undefined
    };
  }
}
