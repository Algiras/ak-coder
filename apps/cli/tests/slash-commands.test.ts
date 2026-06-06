import { describe, it, expect } from 'bun:test';
import { buildSlashCommands, filterReplCompletions } from '../src/slash-commands';
import { AgentCore, MockFileSystem, MockSessionStore, MockLogger, MockLlmService } from '@ak-coder/core';

function makeCore(fs = new MockFileSystem()): AgentCore {
  return new AgentCore(
    fs,
    new MockLlmService(),
    new MockSessionStore(),
    new MockLogger(),
    undefined,
    undefined,
    '/',
  );
}

describe('slash command completions', () => {
  it('includes base commands, skills reload, and loaded skill names', async () => {
    const fs = new MockFileSystem();
    const core = makeCore(fs);

    const empty = buildSlashCommands({ core });
    expect(empty.some(c => c.name === 'skills')).toBe(true);
    expect(empty.some(c => c.name === 'skills reload')).toBe(true);
    expect(empty.some(c => c.name === 'skills:demo-skill')).toBe(false);

    await fs.writeFile('/skills/demo/SKILL.md', `---
name: demo-skill
description: Demo skill
---
Do demo things.`);
    await core.reloadSkills();

    const withSkill = buildSlashCommands({ core });
    expect(withSkill.some(c => c.name === 'skills:demo-skill')).toBe(true);
    expect(withSkill.find(c => c.name === 'skills:demo-skill')?.description).toBe('Demo skill');
  });

  it('filters readline completions by skills: prefix', () => {
    const lines = ['/help', '/skills reload', '/skills:demo-skill'];
    const [hits] = filterReplCompletions('/skills:', lines);
    expect(hits).toEqual(['/skills:demo-skill']);
  });

  it('filters readline completions by /skills prefix', () => {
    const lines = ['/help', '/skills reload', '/skills:demo-skill'];
    const [hits] = filterReplCompletions('/skills', lines);
    expect(hits).toEqual(['/skills reload', '/skills:demo-skill']);
  });
});
