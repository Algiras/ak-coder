import type { TerminalIo } from '../../ports';

type ActivityTerminalIo = TerminalIo & {
  setActivity?: (label: string) => void;
  clearActivity?: () => void;
};

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

/** Show in-progress tool activity in the Ink UI, or fall back to a transcript line. */
export function showToolActivity(terminalIo: TerminalIo | undefined, label: string): void {
  if (!terminalIo) return;
  const io = terminalIo as ActivityTerminalIo;
  if (io.setActivity) {
    io.setActivity(label);
  } else {
    terminalIo.write(`\x1b[36m⠋ ${label}\x1b[0m\n`);
  }
}

/** Clear the live activity indicator when a turn finishes or is interrupted. */
export function clearToolActivity(terminalIo: TerminalIo | undefined): void {
  if (!terminalIo) return;
  const io = terminalIo as ActivityTerminalIo;
  if (io.clearActivity) {
    io.clearActivity();
  }
}
