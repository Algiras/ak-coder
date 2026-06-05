import { describe, it, expect, beforeEach } from 'bun:test';
import { IgnoreMatcher } from '../src/ignore';
import { AgentCore } from '../src/agent';
import {
  MockFileSystem,
  MockTerminalIo,
  MockProcessRunner,
  MockLlmService,
  MockSessionStore,
  MockLogger
} from '../src/mocks';

describe('IgnoreMatcher', () => {
  it('should correctly ignore default patterns', () => {
    const matcher = new IgnoreMatcher();
    expect(matcher.isIgnored('node_modules/lodash/index.js')).toBe(true);
    expect(matcher.isIgnored('.git/config')).toBe(true);
    expect(matcher.isIgnored('src/index.ts')).toBe(false);
  });

  it('should parse ignore file patterns correctly', async () => {
    const mockFs = new MockFileSystem();
    await mockFs.writeFile('/.gitignore', 'logs/\n*.log\n!keep.log');

    const matcher = new IgnoreMatcher();
    await matcher.loadIgnoreFile(mockFs, '/.gitignore');

    expect(matcher.isIgnored('logs/debug.log')).toBe(true);
    expect(matcher.isIgnored('app.log')).toBe(true);
  });
});

describe('AgentCore Engine & Compaction', () => {
  let mockFs: MockFileSystem;
  let mockLlm: MockLlmService;
  let mockStore: MockSessionStore;
  let mockLogger: MockLogger;
  let agent: AgentCore;

  beforeEach(() => {
    mockFs = new MockFileSystem();
    mockLlm = new MockLlmService();
    mockStore = new MockSessionStore();
    mockLogger = new MockLogger();
    agent = new AgentCore(mockFs, mockLlm, mockStore, mockLogger);
  });

  it('should manage file contexts', async () => {
    await mockFs.writeFile('/src/main.ts', 'console.log(1);');
    await agent.startSession('session-1');

    await agent.addFileToContext('/src/main.ts');
    expect(agent.getActiveFiles()).toContain('/src/main.ts');

    const prompt = await agent.getFormattedContextPrompt();
    expect(prompt).toContain('--- File: /src/main.ts ---');
    expect(prompt).toContain('console.log(1);');

    agent.removeFileFromContext('/src/main.ts');
    expect(agent.getActiveFiles()).not.toContain('/src/main.ts');
  });

  it('should trigger compaction when context exceeds threshold', async () => {
    // Set threshold very low to trigger compaction
    (agent as any).maxContextTokens = 10;
    mockLlm.mockResponse = 'Summary: conversations condensed.';

    await agent.startSession('compaction-sess');

    // Process a message that fits initially
    await agent.processMessage('Hi, I want to write a simple compiler.');

    // Process a second message that exceeds 10 tokens (approx characters / 4)
    const result = await agent.processMessage('Here is some very long message that will definitely exceed the token threshold of ten tokens.');

    expect(result.compacted).toBe(true);
    expect(agent.getContextSummary()).toBe('Summary: conversations condensed.');
    // The history retains the preserved messages + the new assistant response
    expect(agent.getMessages().length).toBe(4);
  });
});
