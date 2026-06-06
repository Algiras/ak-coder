import { describe, it, expect } from 'bun:test';
import { workspaceHistoryKey, resolveWorkspaceHistoryDir } from '../src/features/history/workspace-history';

describe('workspace history scoping', () => {
  it('uses a stable key for the same workspace path', () => {
    expect(workspaceHistoryKey('/Users/me/project')).toBe(workspaceHistoryKey('/Users/me/project/'));
    expect(workspaceHistoryKey('/Users/me/project')).not.toBe(workspaceHistoryKey('/Users/me/other'));
  });

  it('resolves a workspace-specific history directory', () => {
    const dir = resolveWorkspaceHistoryDir('/home/.ak-coder/history', '/tmp/demo');
    expect(dir).toMatch(/^\/home\/.ak-coder\/history\/workspaces\/demo-[a-f0-9]{12}$/);
  });
});
