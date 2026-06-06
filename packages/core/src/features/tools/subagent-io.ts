import type { StreamCallback, StreamChunk, TerminalIo } from '../../ports';

export type SubAgentTerminalIo = TerminalIo & {
  beginSubAgent?: (info: { role: string; depth: number }) => void;
  subAgentStream?: (chunk: StreamChunk) => void;
  endSubAgent?: (info: {
    role: string;
    summary?: string;
    inputTokens?: number;
    outputTokens?: number;
    transcript?: 'assistant' | 'system' | 'silent';
  }) => void;
};

export async function runSubAgent<T extends { text: string; inputTokens: number; outputTokens: number }>(options: {
  terminalIo: TerminalIo | undefined;
  role: string;
  depth: number;
  transcript?: 'assistant' | 'system' | 'silent';
  run: (stream: StreamCallback | undefined) => Promise<T>;
}): Promise<T> {
  const io = options.terminalIo as SubAgentTerminalIo;
  const hasStructuredUi = typeof io.beginSubAgent === 'function';

  if (hasStructuredUi) {
    io.beginSubAgent?.({ role: options.role, depth: options.depth });
  } else if (options.terminalIo) {
    options.terminalIo.write(`\n[Spawning Sub-Agent: "${options.role}" at depth ${options.depth}...]\n`);
  }

  const stream: StreamCallback | undefined = io.subAgentStream
    ? (chunk) => io.subAgentStream!(chunk)
    : undefined;

  try {
    const response = await options.run(stream);
    io.endSubAgent?.({
      role: options.role,
      summary: response.text,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      transcript: options.transcript ?? 'silent'
    });
    if (!hasStructuredUi && options.terminalIo) {
      options.terminalIo.write(`\n[Sub-Agent "${options.role}" finished execution]\n`);
    }
    return response;
  } catch (e) {
    io.endSubAgent?.({
      role: options.role,
      summary: `Error: ${(e as Error).message}`,
      transcript: 'system'
    });
    if (!hasStructuredUi && options.terminalIo) {
      options.terminalIo.writeError(`Sub-agent failed: ${(e as Error).message}`);
    }
    throw e;
  }
}
