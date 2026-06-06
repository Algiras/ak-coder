import { describe, it, expect } from 'bun:test';
import { appendStreamDelta } from '../src/adapters/stream-delta';

describe('appendStreamDelta', () => {
  it('passes through incremental deltas', () => {
    let acc = '';
    for (const part of ['The ', 'user ', 'mentioned']) {
      const merged = appendStreamDelta(acc, part);
      acc = merged.value;
      expect(merged.delta).toBe(part);
    }
    expect(acc).toBe('The user mentioned');
  });

  it('deduplicates cumulative reasoning deltas', () => {
    let acc = '';
    const emitted: string[] = [];
    for (const part of ['The user', 'The user mentioned', 'The user mentioned something']) {
      const merged = appendStreamDelta(acc, part);
      acc = merged.value;
      if (merged.delta) emitted.push(merged.delta);
    }
    expect(acc).toBe('The user mentioned something');
    expect(emitted.join('')).toBe('The user mentioned something');
  });
});
