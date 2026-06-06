import { TerminalIo, ConfirmationRequest, ConfirmationResult } from '@ak-coder/core';

// Minimal EventEmitter shim so we don't require @types/node
class TypedEmitter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _map = new Map<string, ((arg: any) => void)[]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emit(event: string, arg?: any) { this._map.get(event)?.forEach(fn => fn(arg)); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, fn: (arg: any) => void) { const a = this._map.get(event) ?? []; a.push(fn); this._map.set(event, a); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: string, fn: (arg: any) => void) { this._map.set(event, (this._map.get(event) ?? []).filter(f => f !== fn)); }
}

export type InteractionEvent =
  | { type: 'ask'; question: string }
  | { type: 'confirm'; request: ConfirmationRequest }
  | { type: 'select'; message: string; choices: { name: string; value: unknown }[] };

/**
 * TerminalIo implementation for the Ink UI.
 *
 * write/writeError emit events that the App appends to its output log.
 * ask/confirm/selectMenu block the calling coroutine via a Promise and signal
 * the App to swap in an interactive sub-prompt; the App resolves the promise
 * by calling the corresponding resolve* method.
 */
export class InkTerminalIo extends TypedEmitter implements TerminalIo {
  private pendingAsk: ((s: string) => void) | null = null;
  private pendingConfirm: ((r: ConfirmationResult) => void) | null = null;
  private pendingSelect: ((v: unknown) => void) | null = null;
  private _batch: string[] | null = null;

  // ── Output ──────────────────────────────────────────────────────────────────

  /** Accumulate writes; flush as a single system message on endBatch(). */
  beginBatch(): void {
    this._batch = [];
  }

  endBatch(): void {
    const lines = this._batch;
    this._batch = null;
    if (lines && lines.length > 0) {
      this.emit('line', { text: lines.join('\n'), error: false, role: 'system' });
    }
  }

  setActivity(label: string): void {
    this.emit('activity', { label });
  }

  clearActivity(): void {
    this.emit('activity', { label: null });
  }

  write(text: string): void {
    if (this._batch !== null) {
      this._batch.push(text);
    } else {
      this.emit('line', { text, error: false, role: 'system' });
    }
  }

  writeError(text: string): void {
    if (this._batch !== null) {
      this._batch.push(text);
    } else {
      this.emit('line', { text, error: true, role: 'system' });
    }
  }

  // ── Interactive ──────────────────────────────────────────────────────────────

  ask(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.pendingAsk = resolve;
      this.emit('interaction', { type: 'ask', question } satisfies InteractionEvent);
    });
  }

  async askConfirm(question: string, defaultConfirm = true): Promise<boolean> {
    const suffix = defaultConfirm ? '[Y/n]' : '[y/N]';
    const answer = await this.ask(`${question} ${suffix}`);
    if (!answer) return defaultConfirm;
    const l = answer.toLowerCase();
    if (l === 'y' || l === 'yes') return true;
    if (l === 'n' || l === 'no') return false;
    return defaultConfirm;
  }

  confirm(request: ConfirmationRequest): Promise<ConfirmationResult> {
    return new Promise((resolve) => {
      this.pendingConfirm = resolve;
      this.emit('interaction', { type: 'confirm', request } satisfies InteractionEvent);
    });
  }

  selectMenu<T>(message: string, choices: { name: string; value: T }[]): Promise<T> {
    return new Promise((resolve) => {
      this.pendingSelect = resolve as (v: unknown) => void;
      this.emit('interaction', {
        type: 'select',
        message,
        choices: choices as { name: string; value: unknown }[]
      } satisfies InteractionEvent);
    });
  }

  // ── Resolvers (called by the App) ──────────────────────────────────────────

  resolveAsk(answer: string): void {
    const fn = this.pendingAsk;
    this.pendingAsk = null;
    fn?.(answer);
  }

  resolveConfirm(result: ConfirmationResult): void {
    const fn = this.pendingConfirm;
    this.pendingConfirm = null;
    fn?.(result);
  }

  resolveSelect(value: unknown): void {
    const fn = this.pendingSelect;
    this.pendingSelect = null;
    fn?.(value);
  }

  // ── Unused by Ink UI (readline-specific) ──────────────────────────────────

  close(): void {}
}
