import { describe, it, expect } from 'bun:test';
import { runSubAgent } from '../src/features/tools/subagent-io';
import type { StreamChunk } from '../src/ports';
import { MockTerminalIo } from '../src/mocks';

class StructuredSubAgentIo extends MockTerminalIo {
  events: string[] = [];
  chunks: StreamChunk[] = [];

  beginSubAgent(info: { role: string; depth: number }) {
    this.events.push(`start:${info.role}:${info.depth}`);
  }

  subAgentStream(chunk: StreamChunk) {
    this.chunks.push(chunk);
  }

  endSubAgent(info: { role: string; summary?: string; transcript?: string }) {
    this.events.push(`end:${info.role}:${info.transcript ?? 'silent'}`);
  }
}

describe('runSubAgent', () => {
  it('routes streaming through structured terminal IO', async () => {
    const io = new StructuredSubAgentIo();
    const result = await runSubAgent({
      terminalIo: io,
      role: 'Auditor',
      depth: 1,
      transcript: 'silent',
      run: async (stream) => {
        stream?.({ type: 'thinking', text: 'hmm' });
        stream?.({ type: 'content', text: 'done' });
        return { text: 'done', inputTokens: 1, outputTokens: 2 };
      }
    });

    expect(result.text).toBe('done');
    expect(io.events).toEqual(['start:Auditor:1', 'end:Auditor:silent']);
    expect(io.chunks.map(c => `${c.type}:${c.text}`)).toEqual(['thinking:hmm', 'content:done']);
  });
});
