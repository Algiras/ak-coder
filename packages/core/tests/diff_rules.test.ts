import { describe, it, expect, beforeEach } from 'bun:test';
import { DiffEngine } from '../src/features/diff/diff';
import { AgentCore } from '../src/agent';
import {
  MockFileSystem,
  MockLlmService,
  MockSessionStore,
  MockLogger
} from '../src/mocks';

describe('DiffEngine', () => {
  it('should correctly compare text and identify added/removed/unchanged lines', () => {
    const oldStr = 'line 1\nline 2\nline 3';
    const newStr = 'line 1\nline 2 mod\nline 3\nline 4';

    const diffs = DiffEngine.compare(oldStr, newStr);

    expect(diffs).toHaveLength(5);
    expect(diffs.filter(d => d.type === 'unchanged')).toHaveLength(2);
    expect(diffs.filter(d => d.type === 'removed')).toHaveLength(1);
    expect(diffs.filter(d => d.type === 'added')).toHaveLength(2);

    const rendered = DiffEngine.renderColorDiff(diffs);
    expect(rendered).toContain('+ line 2 mod');
    expect(rendered).toContain('- line 2');
    expect(rendered).toContain('+ line 4');
  });
});

describe('AgentCore with AGENTS.md Rules', () => {
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
    agent = new AgentCore(mockFs, mockLlm, mockStore, mockLogger, undefined, undefined, '/');
  });

  it('should load AGENTS.md rules and append them to the system prompt', async () => {
    await mockFs.writeFile('/AGENTS.md', 'Always compile before committing.');
    await agent.startSession('test-rules');

    await agent.loadAgentsRules('/');
    await agent.processMessage('Hello');

    const lastPrompt = mockLlm.lastPrompt;
    expect(lastPrompt).toHaveLength(2); // System + User
    expect(lastPrompt[0].content).toContain('Always compile before committing.');
  });

  it('should load SKILL.md rules and append them to the system prompt', async () => {
    const skillContent = `---
name: custom-test-skill
description: "A custom test skill description"
---
Instruction list for this skill.`;

    await mockFs.writeFile('/skills/test-skill/SKILL.md', skillContent);
    await agent.startSession('test-skills');

    await agent.loadSkills('/');
    await agent.processMessage('Hello');

    const lastPrompt = mockLlm.lastPrompt;
    expect(lastPrompt).toHaveLength(2); // System + User
    expect(lastPrompt[0].content).toContain('Available Skills:');
    expect(lastPrompt[0].content).toContain('Skill Name: custom-test-skill');
    expect(lastPrompt[0].content).toContain('Instruction list for this skill.');
  });

  it('reloadSkills picks up newly added SKILL.md files', async () => {
    await agent.startSession('reload-skills');
    await agent.loadSkills('/');
    expect(agent.getSkills()).toHaveLength(0);

    await mockFs.writeFile('/skills/new/SKILL.md', `---
name: new-skill
description: Fresh skill
---
Do the thing.`);

    const count = await agent.reloadSkills();
    expect(count).toBe(1);
    expect(agent.getSkills()[0]?.name).toBe('new-skill');
  });
});
