import * as fs from 'fs';
import * as path from 'path';

let enabled = false;
let uiLogPath: string | null = null;

export function initDebug(options: { enabled: boolean; logDir: string }): void {
  enabled = options.enabled;
  if (!enabled) return;
  fs.mkdirSync(options.logDir, { recursive: true });
  uiLogPath = path.join(options.logDir, 'ui.trace.log');
  trace('debug.enabled', { logDir: options.logDir });
}

export function isDebugEnabled(): boolean {
  return enabled || process.env.AK_CODER_DEBUG === '1' || process.env.AK_CODER_DEBUG === 'true';
}

/** UI/agent trace — stderr + ui.trace.log (never stdout; Ink owns stdout). */
export function trace(event: string, data?: Record<string, unknown>): void {
  if (!enabled) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...data });
  process.stderr.write(`[ak-coder:debug] ${line}\n`);
  if (uiLogPath) {
    try {
      fs.appendFileSync(uiLogPath, line + '\n');
    } catch {
      // ignore log write failures
    }
  }
}
