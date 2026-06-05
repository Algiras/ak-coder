import { describe, it, expect, beforeEach } from 'bun:test';
import { AgentCore } from '../src/agent';
import { CommandSafetyGate } from '../src/safety';
import { FileSessionStore } from '../src/history';
import { LLMService, ChatMessage } from '../src/ports';
import {
  MockFileSystem,
  MockLlmService,
  MockSessionStore,
  MockLogger,
  MockTerminalIo,
  MockProcessRunner
} from '../src/mocks';

class QueueMockLlm implements LLMService {
  public responses: { text: string; tool_calls?: any[] }[] = [];
  public lastPrompt: ChatMessage[] = [];
  public lastTools: any[] | undefined;

  async chat(
    messages: ChatMessage[],
    options?: { stream?: (chunk: string) => void; signal?: AbortSignal; tools?: any[] }
  ): Promise<{ text: string; inputTokens: number; outputTokens: number; tool_calls?: any[] }> {
    this.lastPrompt = messages;
    this.lastTools = options?.tools;
    const resp = this.responses.shift() || { text: 'Plan: ...placeholder plan...' };
    if (options?.stream && resp.text) options.stream(resp.text);
    return { text: resp.text, inputTokens: 10, outputTokens: 15, tool_calls: resp.tool_calls };
  }
}

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
    const agent = new AgentCore(mockFs, mockLlm, mockStore, mockLogger, undefined, undefined, '/workspace');
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

    // Verify history summary file exists in the workspace
    const summaryFileExists = await mockFs.exists('/workspace/.ak-coder/history/summary_eval-session-1.txt');
    expect(summaryFileExists).toBe(true);
    const summaryFileContent = await mockFs.readFile('/workspace/.ak-coder/history/summary_eval-session-1.txt');
    expect(summaryFileContent).toBe('Condensed summary of previous turns.');
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

  // Eval 3: History Resumption and Branching Fork
  it('Eval 3: History Fork and Session Branching', async () => {
    const historyFs = new MockFileSystem();
    const store = new FileSessionStore(historyFs, '/history');

    const messages = [
      { role: 'user' as const, content: 'Turn 0' },
      { role: 'assistant' as const, content: 'Reply 0' },
      { role: 'user' as const, content: 'Turn 1' },
      { role: 'assistant' as const, content: 'Reply 1' },
      { role: 'user' as const, content: 'Turn 2' },
    ];
    await store.saveSession('original', messages);

    // Fork at turn index 2 (inclusive)
    const forked = await store.forkSession('original', 2, 'fork-a');
    expect(forked).toHaveLength(3);
    expect(forked[2].content).toBe('Turn 1');

    // Verify the fork is independently loadable
    const reloaded = await store.loadSession('fork-a');
    expect(reloaded).toHaveLength(3);
    expect(reloaded[0].content).toBe('Turn 0');

    // Original session is untouched
    const original = await store.loadSession('original');
    expect(original).toHaveLength(5);

    // Out-of-bounds fork index throws
    let threw = false;
    try {
      await store.forkSession('original', 99, 'fork-bad');
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  // Eval 4: Bash Safety Classification Matrix
  it('Eval 4: Safety Classification Matrix and Pattern Persistence', async () => {
    const safeFs = new MockFileSystem();
    const gate = new CommandSafetyGate(safeFs, '/ws');
    await gate.loadPermissions();

    // Safe commands
    for (const cmd of ['ls', 'ls -la', 'git status', 'git diff', 'git log --oneline', 'grep foo src/', 'cat README.md']) {
      expect(gate.classifyCommand(cmd)).toBe('safe');
    }

    // Unsafe commands
    for (const cmd of ['rm -rf src/', 'npm run build', 'curl http://example.com', 'bun test', 'docker run']) {
      expect(gate.classifyCommand(cmd)).toBe('unsafe');
      expect(gate.isAuthorized(cmd)).toBe(false);
    }

    // Authorize and verify, then reload from disk to confirm persistence
    await gate.authorizePattern('npm run build');
    expect(gate.isAuthorized('npm run build')).toBe(true);

    const gate2 = new CommandSafetyGate(safeFs, '/ws');
    await gate2.loadPermissions();
    expect(gate2.isAuthorized('npm run build')).toBe(true);
    expect(gate2.isAuthorized('npm run test')).toBe(false); // different suffix not covered
  });

  // Eval 6: Plan Mode — tool gating and system prompt directive
  it('Eval 6: Plan Mode blocks mutating tools and injects plan-mode directive into system prompt', async () => {
    const planFs = new MockFileSystem();
    planFs.files.set('/workspace/src/app.ts', 'export function hello() {}');
    const planLlm = new QueueMockLlm();
    const planStore = new MockSessionStore();
    const planLogger = new MockLogger();
    const planNio = new MockTerminalIo();
    const planNpr = new MockProcessRunner();

    const agent = new AgentCore(planFs, planLlm, planStore, planLogger, planNpr, planNio, '/workspace');
    agent.setConfirmationMode('plan');
    await agent.startSession('eval-6-plan');

    // LLM tries to call write_file in plan mode — should be denied by policy
    planLlm.responses = [
      {
        text: 'I will write the file',
        tool_calls: [
          {
            id: 'call_w',
            type: 'function',
            function: { name: 'write_file', arguments: JSON.stringify({ path: '/workspace/src/new.ts', content: 'malicious' }) }
          }
        ]
      },
      { text: 'Here is the plan: 1. Read app.ts 2. Propose changes.' }
    ];

    const result = await agent.processMessage('Add a foo function');

    // Tool call was denied — file must NOT exist
    expect(planFs.files.has('/workspace/src/new.ts')).toBe(false);

    // System prompt sent to LLM must contain plan-mode directive
    const sysMsg = planLlm.lastPrompt.find(m => m.role === 'system');
    expect(sysMsg?.content).toContain('PLAN MODE ACTIVE');

    // write_file must NOT appear in the tool list exposed to LLM
    const toolNames = (planLlm.lastTools ?? []).map((t: any) => t.function.name);
    expect(toolNames).not.toContain('write_file');
    expect(toolNames).not.toContain('patch_file');
    expect(toolNames).not.toContain('bash');

    // Final response is a plan, not an execution
    expect(result.text).toContain('plan');
  });

  // Eval 5: Compaction Boundary Trigger
  it('Eval 5: Compaction Boundary — below threshold no compaction, at threshold compacts', async () => {
    const agent = new AgentCore(mockFs, mockLlm, mockStore, mockLogger);

    // Keep last 4 messages when compacting
    const expectedPreserveCount = 4;

    // Set threshold so first two short turns stay below limit
    (agent as any).maxContextTokens = 50;
    mockLlm.mockResponse = 'Summary of prior turns.';
    await agent.startSession('eval-5-boundary');

    // Turn 1 — short, no compaction
    await agent.processMessage('Hi');
    expect(agent.getContextSummary()).toBeNull();

    // Turn 2 — still below; responses are short mock strings
    const r2 = await agent.processMessage('What is 2+2?');
    expect(r2.compacted).toBe(false);

    // Force a large payload to push over the threshold
    (agent as any).maxContextTokens = 1; // force immediate compaction on next turn
    mockLlm.mockResponse = 'Summary of prior turns.';
    const r3 = await agent.processMessage('Now compact me');
    expect(r3.compacted).toBe(true);
    expect(agent.getContextSummary()).toBe('Summary of prior turns.');

    // After compaction: preserved (≤4) messages + 1 final assistant response
    expect(agent.getMessages().length).toBeLessThanOrEqual(expectedPreserveCount + 1);
  });
});
