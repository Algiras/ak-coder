import { describe, it, expect, beforeEach } from 'bun:test';
import { AgentCore } from '../src/agent';
import { LLMService, ChatMessage } from '../src/ports';
import {
  MockFileSystem,
  MockSessionStore,
  MockLogger,
  MockTerminalIo,
  MockProcessRunner,
} from '../src/mocks';

// Minimal LLM stub — returns configurable responses
class StubLlm implements LLMService {
  responses: string[];
  constructor(...responses: string[]) { this.responses = responses; }
  async chat(_msgs: ChatMessage[], opts?: { stream?: (c: string) => void }) {
    const text = this.responses.shift() ?? 'ok';
    opts?.stream?.(text);
    return { text, inputTokens: 5, outputTokens: 5 };
  }
}

function makeCore(llm: LLMService) {
  const fs = new MockFileSystem();
  const store = new MockSessionStore();
  const logger = new MockLogger();
  const nio = new MockTerminalIo();
  const runner = new MockProcessRunner();
  return { core: new AgentCore(fs, llm, store, logger, runner, nio, '/ws'), store };
}

// Build a session with N completed user/assistant turn pairs directly in the store
async function seedTurns(core: AgentCore, turns: { user: string; assistant: string }[]) {
  await core.startSession('test-sess');
  // Inject messages directly so we don't need real LLM responses for seeding
  const msgs: ChatMessage[] = [];
  for (const t of turns) {
    msgs.push({ role: 'user', content: t.user });
    msgs.push({ role: 'assistant', content: t.assistant });
  }
  // @ts-ignore — access private field for test seeding
  core['messages'] = msgs;
  // @ts-ignore
  core['sessionId'] = 'test-sess';
}

describe('AgentCore.getUserTurns', () => {
  it('returns one entry per user message with preview and indices', async () => {
    const { core } = makeCore(new StubLlm());
    await seedTurns(core, [
      { user: 'Hello world', assistant: 'Hi' },
      { user: 'How are you?', assistant: 'Fine' },
    ]);

    const turns = core.getUserTurns();
    expect(turns).toHaveLength(2);
    expect(turns[0].turnIndex).toBe(0);
    expect(turns[0].preview).toBe('Hello world');
    expect(turns[1].turnIndex).toBe(1);
    expect(turns[1].preview).toBe('How are you?');
  });

  it('truncates long previews to 60 characters', async () => {
    const { core } = makeCore(new StubLlm());
    await seedTurns(core, [
      { user: 'A'.repeat(80), assistant: 'B' },
    ]);

    const turns = core.getUserTurns();
    expect(turns[0].preview.length).toBeLessThanOrEqual(60);
  });

  it('returns empty array when no messages exist', async () => {
    const { core } = makeCore(new StubLlm());
    await core.startSession('empty-sess');
    expect(core.getUserTurns()).toHaveLength(0);
  });

  it('collapses multi-line user messages into a single-line preview', async () => {
    const { core } = makeCore(new StubLlm());
    await seedTurns(core, [{ user: 'line one\nline two', assistant: 'ok' }]);
    const turns = core.getUserTurns();
    expect(turns[0].preview).not.toContain('\n');
  });
});

describe('AgentCore.rewindToTurn', () => {
  it('keeps only messages up to and including the target turn', async () => {
    const { core } = makeCore(new StubLlm());
    await seedTurns(core, [
      { user: 'turn 1', assistant: 'reply 1' },
      { user: 'turn 2', assistant: 'reply 2' },
      { user: 'turn 3', assistant: 'reply 3' },
    ]);

    await core.rewindToTurn(0); // keep only turn 1 (user + assistant)

    const msgs = core.getMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe('turn 1');
    expect(msgs[1].content).toBe('reply 1');
  });

  it('rewinding to the last turn keeps all messages', async () => {
    const { core } = makeCore(new StubLlm());
    await seedTurns(core, [
      { user: 'a', assistant: 'A' },
      { user: 'b', assistant: 'B' },
    ]);

    await core.rewindToTurn(1); // last turn — nothing discarded

    expect(core.getMessages()).toHaveLength(4);
  });

  it('persists the truncated session to the store', async () => {
    const { core, store } = makeCore(new StubLlm());
    await seedTurns(core, [
      { user: 'x', assistant: 'X' },
      { user: 'y', assistant: 'Y' },
    ]);

    await core.rewindToTurn(0);

    const persisted = await store.loadSession('test-sess');
    expect(persisted).toHaveLength(2);
    expect(persisted[1].content).toBe('X');
  });

  it('throws when turnIndex is out of range', async () => {
    const { core } = makeCore(new StubLlm());
    await seedTurns(core, [{ user: 'only turn', assistant: 'ok' }]);

    await expect(core.rewindToTurn(5)).rejects.toThrow('out of range');
  });

  it('throws when no session is active', async () => {
    const { core } = makeCore(new StubLlm());
    await expect(core.rewindToTurn(0)).rejects.toThrow('No active session');
  });

  it('works correctly when tool messages are interleaved between turns', async () => {
    const { core } = makeCore(new StubLlm());
    await core.startSession('tool-sess');
    // @ts-ignore
    core['sessionId'] = 'tool-sess';
    // @ts-ignore
    core['messages'] = [
      { role: 'user', content: 'turn 1' },
      { role: 'assistant', content: 'calling tool', tool_calls: [] },
      { role: 'tool', tool_call_id: 't1', name: 'read_file', content: 'file contents' },
      { role: 'assistant', content: 'done with tool' },
      { role: 'user', content: 'turn 2' },
      { role: 'assistant', content: 'reply 2' },
    ];

    await core.rewindToTurn(0); // keep everything before turn 2

    const msgs = core.getMessages();
    expect(msgs).toHaveLength(4); // user + assistant + tool + assistant
    expect(msgs[msgs.length - 1].content).toBe('done with tool');
  });
});
