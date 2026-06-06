import { describe, it, expect } from 'bun:test';
import { writeFileTool } from '../src/features/tools/write_file';
import { MockFileSystem, MockTerminalIo } from '../src/mocks';
import { ConfirmationPolicy } from '../src/features/confirmation/confirmation';
import type { ToolContext } from '../src/features/tools/types';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  const fs = new MockFileSystem();
  return {
    fs,
    terminalIo: new MockTerminalIo(),
    workspaceRoot: '/workspace',
    readFiles: new Set<string>(),
    hooks: {},
    confirmationPolicy: new ConfirmationPolicy('default'),
    getSessionId: () => 'test',
    resolveWorkspacePath: (p) => `/workspace/${p.replace(/^\.\//, '')}`,
    markModified: () => {},
    resetConsecutiveReads: () => {},
    ...overrides,
  };
}

describe('skill reload on write', () => {
  it('reloads skills after writing a new SKILL.md', async () => {
    let reloadCount = 0;
    const ctx = makeCtx({
      reloadSkills: async () => { reloadCount++; },
    });
    const tool = writeFileTool(ctx);
    const result = await tool.handler({ path: '.cursor/skills/demo/SKILL.md', content: '# skill' });
    expect(result).toContain('Skills reloaded');
    expect(reloadCount).toBe(1);
    expect(await ctx.fs.readFile('/workspace/.cursor/skills/demo/SKILL.md')).toBe('# skill');
  });

  it('does not reload skills for ordinary files', async () => {
    let reloadCount = 0;
    const ctx = makeCtx({
      reloadSkills: async () => { reloadCount++; },
    });
    const tool = writeFileTool(ctx);
    const result = await tool.handler({ path: 'readme.md', content: '# readme' });
    expect(result).not.toContain('Skills reloaded');
    expect(reloadCount).toBe(0);
  });
});
