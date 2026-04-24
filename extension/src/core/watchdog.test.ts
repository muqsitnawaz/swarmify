import { describe, it, expect } from 'bun:test';
import {
  classifyTerminal,
  renderWatchdogPrompt,
  parseWatchdogResponse,
} from './watchdog';

describe('classifyTerminal', () => {
  const base = {
    nowMs: 1_000_000,
    lastNudgeMs: null,
    optedOut: false,
    stallMs: 90_000,
    cooldownMs: 300_000,
    dormantMs: 3_600_000,
  };

  it('active when within stall window', () => {
    const r = classifyTerminal({ ...base, lastActivityMs: base.nowMs - 10_000 });
    expect(r.kind).toBe('active');
  });

  it('opted_out when user disabled watchdog for terminal', () => {
    const r = classifyTerminal({
      ...base,
      lastActivityMs: base.nowMs - 120_000,
      optedOut: true,
    });
    expect(r.kind).toBe('opted_out');
  });

  it('dormant when session is older than dormant window', () => {
    const r = classifyTerminal({ ...base, lastActivityMs: base.nowMs - 3_600_001 });
    expect(r.kind).toBe('dormant');
  });

  it('rate_limited when recently nudged', () => {
    const r = classifyTerminal({
      ...base,
      lastActivityMs: base.nowMs - 120_000,
      lastNudgeMs: base.nowMs - 60_000,
    });
    expect(r.kind).toBe('rate_limited');
    if (r.kind === 'rate_limited') {
      expect(r.cooldownRemainingMs).toBe(240_000);
    }
  });

  it('stalled when past threshold, not dormant, not rate limited, not opted out', () => {
    const r = classifyTerminal({ ...base, lastActivityMs: base.nowMs - 120_000 });
    expect(r.kind).toBe('stalled');
    if (r.kind === 'stalled') {
      expect(r.stalledForMs).toBe(120_000);
    }
  });

  it('opt-out wins over active', () => {
    const r = classifyTerminal({
      ...base,
      lastActivityMs: base.nowMs - 10_000,
      optedOut: true,
    });
    expect(r.kind).toBe('opted_out');
  });

  it('cooldown expired lets terminal go back to stalled', () => {
    const r = classifyTerminal({
      ...base,
      lastActivityMs: base.nowMs - 400_000,
      lastNudgeMs: base.nowMs - 310_000,
    });
    expect(r.kind).toBe('stalled');
  });
});

describe('renderWatchdogPrompt', () => {
  it('embeds terminal id, agent type, stall duration, and JSONL tail', () => {
    const out = renderWatchdogPrompt([
      {
        terminalId: 'CC-1',
        agentType: 'claude',
        tailLines: [
          '{"type":"assistant","message":{"content":[{"type":"text","text":"I\'ll write inventory.sh."}]}}',
        ],
        stalledForMs: 120_000,
      },
    ]);
    expect(out).toContain('CC-1');
    expect(out).toContain('claude');
    expect(out).toContain('idle 120s');
    expect(out).toContain("I'll write inventory.sh");
    expect(out).toContain('JSON array');
  });

  it('separates multiple terminals into labeled sections', () => {
    const out = renderWatchdogPrompt([
      { terminalId: 'CC-1', agentType: 'claude', tailLines: ['{"a":1}'], stalledForMs: 100_000 },
      { terminalId: 'CX-2', agentType: 'codex', tailLines: ['{"b":2}'], stalledForMs: 200_000 },
    ]);
    expect(out).toContain('terminal CC-1');
    expect(out).toContain('terminal CX-2');
    expect(out).toContain('idle 100s');
    expect(out).toContain('idle 200s');
  });
});

describe('parseWatchdogResponse', () => {
  it('parses a clean JSON array', () => {
    const d = parseWatchdogResponse(
      '[{"terminalId":"CC-1","action":"nudge","text":"Show the file.","reason":"broken_promise"}]'
    );
    expect(d).toHaveLength(1);
    expect(d[0]).toEqual({
      terminalId: 'CC-1',
      action: 'nudge',
      text: 'Show the file.',
      reason: 'broken_promise',
    });
  });

  it('tolerates leading and trailing prose', () => {
    const d = parseWatchdogResponse(
      'Here is the response:\n[{"terminalId":"CC-1","action":"skip","text":"","reason":"waiting_on_user"}]\nThanks.'
    );
    expect(d).toHaveLength(1);
    expect(d[0].action).toBe('skip');
  });

  it('returns empty on malformed JSON', () => {
    expect(parseWatchdogResponse('not json at all')).toEqual([]);
    expect(parseWatchdogResponse('[{invalid]')).toEqual([]);
  });

  it('skips entries missing required fields', () => {
    const d = parseWatchdogResponse(
      '[{"terminalId":"CC-1","action":"nudge","text":"ok","reason":"r"},{"action":"nudge"},{"terminalId":"CX-2"}]'
    );
    expect(d).toHaveLength(1);
    expect(d[0].terminalId).toBe('CC-1');
  });

  it('rejects unknown action values', () => {
    const d = parseWatchdogResponse(
      '[{"terminalId":"CC-1","action":"explode","text":"","reason":""}]'
    );
    expect(d).toEqual([]);
  });

  it('handles empty input', () => {
    expect(parseWatchdogResponse('')).toEqual([]);
    expect(parseWatchdogResponse('   \n ')).toEqual([]);
  });
});
