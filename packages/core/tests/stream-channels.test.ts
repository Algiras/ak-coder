import { describe, it, expect } from 'bun:test';
import { ChannelStreamParser, stripChannelMarkers } from '../src/adapters/stream-channels';

describe('ChannelStreamParser', () => {
  it('routes text between channel markers to thinking vs content', () => {
    const parts: string[] = [];
    const parser = new ChannelStreamParser();
    parser.feed('Before <|channel>thought\nReason A\n<channel|>\nAfter', (type, text) => {
      parts.push(`${type}:${JSON.stringify(text)}`);
    });
    parser.flush((type, text) => parts.push(`${type}:${JSON.stringify(text)}`));

    expect(parts).toEqual([
      'content:"Before "',
      'thinking:"Reason A\\n"',
      'content:"After"'
    ]);
  });

  it('handles markers split across stream chunks', () => {
    const thinking: string[] = [];
    const content: string[] = [];
    const parser = new ChannelStreamParser();
    const emit = (type: 'content' | 'thinking', text: string) => {
      (type === 'thinking' ? thinking : content).push(text);
    };

    parser.feed('Hi <|chan', emit);
    parser.feed('nel>thought\nCoT\n<channel|>\nAnswer', emit);
    parser.flush(emit);

    expect(thinking.join('')).toBe('CoT\n');
    expect(content.join('')).toBe('Hi Answer');
  });

  it('stripChannelMarkers cleans a full response', () => {
    const raw = 'Intro\n<|channel>thought\n\n<channel|>\nFinal answer';
    expect(stripChannelMarkers(raw)).toEqual({
      content: 'Intro\nFinal answer',
      thinking: ''
    });
  });
});
