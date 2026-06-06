/** Split model content that embeds reasoning via channel markers (e.g. openrouter/free). */

export type StreamChannelMode = 'content' | 'thinking';

const THINKING_START =
  /<\|channel\|?(?:>|\|>)?(?:thought|analysis|commentary)\b/i;

const CHANNEL_END =
  /(?:<\|channel\|>(?:\s*\n)?|<channel\|>(?:\s*\n)?|<\|channel\|>final\b)/i;

/** Longest prefix we might need to hold back while streaming. */
const MAX_MARKER_PREFIX = 24;

function longestPartialMarkerSuffix(text: string): number {
  const max = Math.min(text.length, MAX_MARKER_PREFIX);
  for (let len = max; len > 0; len--) {
    const tail = text.slice(-len);
    if ('<|channel>thought'.startsWith(tail) ||
        '<|channel|>thought'.startsWith(tail) ||
        '<|channel|>analysis'.startsWith(tail) ||
        '<|channel|>final'.startsWith(tail) ||
        '<channel|>'.startsWith(tail) ||
        '<|channel|>'.startsWith(tail)) {
      return len;
    }
  }
  return 0;
}

export class ChannelStreamParser {
  private mode: StreamChannelMode = 'content';
  private pending = '';

  getMode(): StreamChannelMode {
    return this.mode;
  }

  feed(
    chunk: string,
    emit: (type: StreamChannelMode, text: string) => void
  ): void {
    let buf = this.pending + chunk;
    this.pending = '';

    while (buf.length > 0) {
      if (this.mode === 'content') {
        const start = buf.search(THINKING_START);
        if (start === -1) {
          const hold = longestPartialMarkerSuffix(buf);
          const safe = hold > 0 ? buf.slice(0, -hold) : buf;
          if (safe) emit('content', safe);
          this.pending = hold > 0 ? buf.slice(-hold) : '';
          break;
        }
        const before = buf.slice(0, start);
        if (before) emit('content', before);
        buf = buf.slice(start).replace(THINKING_START, '').replace(/^\s+/, '');
        this.mode = 'thinking';
        continue;
      }

      const end = buf.search(CHANNEL_END);
      if (end === -1) {
        const hold = longestPartialMarkerSuffix(buf);
        const safe = hold > 0 ? buf.slice(0, -hold) : buf;
        if (safe.trim()) emit('thinking', safe);
        this.pending = hold > 0 ? buf.slice(-hold) : '';
        break;
      }
      const thinkingPart = buf.slice(0, end);
      if (thinkingPart.trim()) emit('thinking', thinkingPart);
      buf = buf.slice(end).replace(CHANNEL_END, '').replace(/^\s+/, '');
      this.mode = 'content';
    }
  }

  flush(emit: (type: StreamChannelMode, text: string) => void): void {
    if (!this.pending) return;
    emit(this.mode, this.pending);
    this.pending = '';
  }
}

/** Strip channel markers from a complete string (non-streaming fallback). */
export function stripChannelMarkers(text: string): { content: string; thinking: string } {
  let content = '';
  let thinking = '';
  const parser = new ChannelStreamParser();
  parser.feed(text, (type, part) => {
    if (type === 'thinking') thinking += part;
    else content += part;
  });
  parser.flush((type, part) => {
    if (type === 'thinking') thinking += part;
    else content += part;
  });
  return { content, thinking };
}
