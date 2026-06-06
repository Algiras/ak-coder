/** Returns a compact human-readable label for a tool invocation, e.g. `read_file(src/app.ts)`. */
export function formatToolCall(name: string, args: Record<string, unknown>): string {
  // Key parameter per tool name — pick the most informative one
  const key =
    args['path'] ??
    args['file_path'] ??
    args['command'] ??
    args['query'] ??
    args['pattern'] ??
    args['dir'] ??
    args['directory'] ??
    args['url'] ??
    null;

  if (key == null) return name;

  let display = String(key);
  // For paths, keep only the last 2 segments to stay compact
  if (typeof key === 'string' && (key.includes('/') || key.includes('\\'))) {
    const parts = key.replace(/\\/g, '/').split('/').filter(Boolean);
    display = parts.slice(-2).join('/');
  }
  // Truncate long values (e.g. bash commands)
  if (display.length > 40) display = display.slice(0, 38) + '…';

  return `${name}(${display})`;
}
