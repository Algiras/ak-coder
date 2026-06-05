import { describe, it, expect, beforeEach } from 'bun:test';
import { AgentCore } from '../src/agent';
import { CommandSafetyGate } from '../src/safety';
import { McpClient } from '../src/mcp';
import {
  MockFileSystem,
  MockLlmService,
  MockSessionStore,
  MockLogger
} from '../src/mocks';
import * as path from 'path';
import * as fs from 'fs/promises';

describe('Automated Agent Flow Evaluations', () => {
  let mockFs: MockFileSystem;
  let mockLlm: MockLlmService;
  let mockStore: MockSessionStore;
  let mockLogger: MockLogger;

  beforeEach(() => {
    mockFs = new MockFileSystem();
    mockLlm = new MockLlmService();
    mockStore = new MockSessionStore();
    mockLogger = new MockLogger();
  });

  // Eval 1: Dialogue Flow & Compaction Check
  it('Eval 1: Dialogue & Summarization Compaction Loop', async () => {
    const agent = new AgentCore(mockFs, mockLlm, mockStore, mockLogger);
    (agent as any).maxContextTokens = 12; // Very small to trigger compaction
    mockLlm.mockResponse = 'Condensed summary of previous turns.';

    await agent.startSession('eval-session-1');

    // Turn 1
    await agent.processMessage('Write a simple python script.');
    expect(agent.getContextSummary()).toBeNull(); // No compaction yet

    // Turn 2: Exceeds threshold
    const result = await agent.processMessage('Now make it write to a file and compile it.');
    
    expect(result.compacted).toBe(true);
    expect(agent.getContextSummary()).toBe('Condensed summary of previous turns.');
    expect(agent.getMessages().length).toBe(4); // Last few preserved
  });

  // Eval 2: Safe/Unsafe Bash Execution Safety Gate
  it('Eval 2: Bash Safety Gate Blocking and Caching', async () => {
    const gate = new CommandSafetyGate(mockFs, '/workspace');
    await gate.loadPermissions();

    // Check unsafe commands are blocked initially
    expect(gate.classifyCommand('rm -rf src/')).toBe('unsafe');
    expect(gate.isAuthorized('rm -rf src/')).toBe(false);

    // Authorize pattern
    await gate.authorizePattern('rm -rf src/');
    expect(gate.isAuthorized('rm -rf src/')).toBe(true);
    expect(gate.isAuthorized('rm -rf src/app.ts')).toBe(true);

    // Verify persistence
    expect(await mockFs.exists('/workspace/.ak-coder/permissions.json')).toBe(true);
  });
});
