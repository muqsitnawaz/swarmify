import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  pickBestVersion,
  sessionUsedPercent,
  AgentsViewJsonAgent,
  AgentsViewJsonVersion,
} from './resumeInBest';

// Real fixture captured from `agents view claude --json` on 2026-04-22.
// Has 10 Claude versions, mixed states: rate_limited + out_of_credits across
// 5 accounts, plus 3 not-signed-in entries. Also present: default flag on
// 2.1.112 at 19% session, and 2.1.111 at 0% session on a different account.
const FIXTURE_PATH = path.join(__dirname, 'testdata', 'view-claude.json');
const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8')) as AgentsViewJsonAgent;

function makeVersion(overrides: Partial<AgentsViewJsonVersion> = {}): AgentsViewJsonVersion {
  return {
    version: '2.1.112',
    isDefault: false,
    signedIn: true,
    email: 'user@example.com',
    plan: 'Max',
    usageStatus: 'rate_limited',
    windows: [
      { key: 'session', usedPercent: 10, resetsAt: '2026-04-22T18:00:00Z' },
      { key: 'week', usedPercent: 40, resetsAt: '2026-04-28T18:00:00Z' },
    ],
    lastActive: '2026-04-22T12:00:00Z',
    path: '/home/user/.agents/versions/claude/2.1.112',
    ...overrides,
  };
}

describe('pickBestVersion — real fixture', () => {
  test('fixture has the expected shape', () => {
    expect(fixture.agent).toBe('claude');
    expect(fixture.versions.length).toBeGreaterThan(5);
    expect(fixture.versions.some(v => v.isDefault)).toBe(true);
    expect(fixture.versions.some(v => !v.signedIn)).toBe(true);
    expect(fixture.versions.some(v => v.usageStatus === 'out_of_credits')).toBe(true);
  });

  test('picks the signed-in, not-out-of-credits version with lowest session%', () => {
    const picked = pickBestVersion(fixture.versions);
    expect(picked).not.toBeNull();
    expect(picked!.signedIn).toBe(true);
    expect(picked!.usageStatus).not.toBe('out_of_credits');

    // Every other usable candidate must have session% >= picked's session%.
    const usable = fixture.versions.filter(
      v => v.signedIn && v.usageStatus !== 'out_of_credits'
    );
    for (const v of usable) {
      expect(sessionUsedPercent(v)).toBeGreaterThanOrEqual(sessionUsedPercent(picked!));
    }
  });

  test('does NOT pick the default if a better candidate exists', () => {
    const def = fixture.versions.find(v => v.isDefault)!;
    const picked = pickBestVersion(fixture.versions);
    if (sessionUsedPercent(def) > sessionUsedPercent(picked!)) {
      expect(picked!.version).not.toBe(def.version);
    }
  });
});

describe('pickBestVersion — synthetic cases', () => {
  test('returns null when no versions are signed in', () => {
    const versions = [
      makeVersion({ signedIn: false, email: null }),
      makeVersion({ signedIn: false, email: null, version: '2.1.100' }),
    ];
    expect(pickBestVersion(versions)).toBeNull();
  });

  test('returns null on empty input', () => {
    expect(pickBestVersion([])).toBeNull();
  });

  test('prefers lower session% even when higher% has usageStatus=available', () => {
    const versions = [
      makeVersion({ version: 'A', usageStatus: 'available', windows: [{ key: 'session', usedPercent: 80, resetsAt: null }] }),
      makeVersion({ version: 'B', usageStatus: 'rate_limited', windows: [{ key: 'session', usedPercent: 0, resetsAt: null }] }),
    ];
    expect(pickBestVersion(versions)!.version).toBe('B');
  });

  test('breaks ties on session% using usageStatus (available > rate_limited)', () => {
    const versions = [
      makeVersion({ version: 'A', usageStatus: 'rate_limited', windows: [{ key: 'session', usedPercent: 0, resetsAt: null }] }),
      makeVersion({ version: 'B', usageStatus: 'available',    windows: [{ key: 'session', usedPercent: 0, resetsAt: null }] }),
    ];
    expect(pickBestVersion(versions)!.version).toBe('B');
  });

  test('breaks further ties using lastActive (more recent wins)', () => {
    const versions = [
      makeVersion({ version: 'older', lastActive: '2026-04-20T10:00:00Z', windows: [{ key: 'session', usedPercent: 0, resetsAt: null }] }),
      makeVersion({ version: 'newer', lastActive: '2026-04-22T10:00:00Z', windows: [{ key: 'session', usedPercent: 0, resetsAt: null }] }),
    ];
    expect(pickBestVersion(versions)!.version).toBe('newer');
  });

  test('falls back to out_of_credits when every signed-in version is out_of_credits', () => {
    const versions = [
      makeVersion({ version: 'X', usageStatus: 'out_of_credits', windows: [{ key: 'session', usedPercent: 50, resetsAt: null }] }),
      makeVersion({ version: 'Y', usageStatus: 'out_of_credits', windows: [{ key: 'session', usedPercent: 10, resetsAt: null }] }),
    ];
    const picked = pickBestVersion(versions);
    expect(picked).not.toBeNull();
    expect(picked!.version).toBe('Y'); // lowest session%
  });

  test('ignores not-signed-in entries even if they have 0% session', () => {
    const versions = [
      makeVersion({ version: 'fresh', signedIn: false, email: null, windows: [{ key: 'session', usedPercent: 0, resetsAt: null }] }),
      makeVersion({ version: 'used', signedIn: true, windows: [{ key: 'session', usedPercent: 30, resetsAt: null }] }),
    ];
    expect(pickBestVersion(versions)!.version).toBe('used');
  });

  test('treats missing session window as 100% (worst case)', () => {
    const versions = [
      makeVersion({ version: 'no-session', windows: [{ key: 'week', usedPercent: 5, resetsAt: null }] }),
      makeVersion({ version: 'has-session', windows: [{ key: 'session', usedPercent: 50, resetsAt: null }] }),
    ];
    expect(pickBestVersion(versions)!.version).toBe('has-session');
  });
});

describe('sessionUsedPercent', () => {
  test('returns the session window percent', () => {
    expect(sessionUsedPercent(makeVersion({
      windows: [{ key: 'session', usedPercent: 42, resetsAt: null }]
    }))).toBe(42);
  });

  test('returns 100 when session window is missing', () => {
    expect(sessionUsedPercent(makeVersion({
      windows: [{ key: 'week', usedPercent: 5, resetsAt: null }]
    }))).toBe(100);
  });
});
