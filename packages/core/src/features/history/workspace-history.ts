import { createHash } from 'crypto';

/** Stable directory name for a workspace root under ~/.ak-coder/history/workspaces/. */
export function workspaceHistoryKey(workspaceRoot: string): string {
  const normalized = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 12);
  const base = normalized.split('/').filter(Boolean).pop() ?? 'root';
  const safeBase = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 32);
  return `${safeBase}-${hash}`;
}

export function resolveWorkspaceHistoryDir(baseHistoryDir: string, workspaceRoot: string): string {
  const key = workspaceHistoryKey(workspaceRoot);
  return `${baseHistoryDir.replace(/\/$/, '')}/workspaces/${key}`;
}
