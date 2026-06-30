// The streaming feed parses cloud_summary incrementally (only appended bytes)
// instead of re-scanning the whole growing buffer per token. This guards that
// the incremental result is byte-for-byte identical to a full parse at EVERY
// streaming prefix — including partial trailing lines mid-token.
import { describe, test, expect } from 'bun:test';
import {
  parseCloudSummary,
  parseCloudSummaryIncremental,
  emptyCloudParseCache,
} from '../ui/settings/components/mission-control/cloudActivity';

const LINES = [
  'claude · plan · main',
  JSON.stringify({ type: 'system', subtype: 'init' }),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'let me look' }] } }),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Reading the file.' }] } }),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file: 'a.ts' } }] } }),
  JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } }),
  JSON.stringify({ type: 'result', subtype: 'success' }),
];

describe('parseCloudSummaryIncremental', () => {
  test('matches full parse at every character-level streaming prefix', () => {
    const full = LINES.join('\n') + '\n';
    const cache = emptyCloudParseCache();
    // Reveal the buffer one character at a time (the worst case: every prefix
    // ends mid-line). At each step the incremental result must equal a fresh
    // full parse of the same prefix.
    for (let i = 1; i <= full.length; i++) {
      const prefix = full.slice(0, i);
      const inc = parseCloudSummaryIncremental(prefix, cache);
      const fresh = parseCloudSummary(prefix);
      expect(inc).toEqual(fresh);
    }
  });

  test('only appended bytes are parsed (committedChars advances, never rewinds)', () => {
    const cache = emptyCloudParseCache();
    let buf = '';
    let lastCommitted = 0;
    for (const line of LINES) {
      buf += line + '\n';
      parseCloudSummaryIncremental(buf, cache);
      expect(cache.committedChars).toBeGreaterThanOrEqual(lastCommitted);
      lastCommitted = cache.committedChars;
    }
    // After all complete lines, the committed cursor is at end of buffer.
    expect(cache.committedChars).toBe(buf.length);
    expect(parseCloudSummaryIncremental(buf, cache)).toEqual(parseCloudSummary(buf));
  });

  test('full reparse when the buffer is replaced (not a prefix extension)', () => {
    const cache = emptyCloudParseCache();
    const a = LINES.slice(0, 4).join('\n') + '\n';
    parseCloudSummaryIncremental(a, cache);
    // A different, shorter buffer that is NOT a prefix of the cached one.
    const b = JSON.stringify({ type: 'system', subtype: 'reset' }) + '\n';
    expect(parseCloudSummaryIncremental(b, cache)).toEqual(parseCloudSummary(b));
  });
});
