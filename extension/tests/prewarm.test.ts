import { describe, test, expect } from 'bun:test';
import { planRestore, TerminalSessionMapping } from '../src/core/prewarm';

// planRestore is the pure decision core behind restoreTerminals(): given the
// clean-shutdown flag and the persisted crash mappings, it decides whether to
// prompt, what to re-open, and when to clear the stored mappings. These are the
// branches that must not regress - restoring after a clean shutdown would spawn
// duplicate terminals, and failing to clear would re-prompt on every launch.

function mapping(overrides: Partial<TerminalSessionMapping> = {}): TerminalSessionMapping {
  return {
    terminalId: 'CC-1700000000000-1',
    sessionId: '4a78949e-0000-0000-0000-000000000000',
    agentType: 'claude',
    createdAt: 1700000000000,
    workingDirectory: '/tmp/ws',
    ...overrides,
  };
}

describe('planRestore', () => {
  test('clean shutdown clears mappings and never restores', () => {
    const plan = planRestore(true, [mapping()]);
    expect(plan.shouldPrompt).toBe(false);
    expect(plan.toRestore).toHaveLength(0);
    expect(plan.clearMappingsNow).toBe(true);
  });

  test('crash with no mappings is a no-op (nothing to clear)', () => {
    const plan = planRestore(false, []);
    expect(plan.shouldPrompt).toBe(false);
    expect(plan.toRestore).toHaveLength(0);
    expect(plan.clearMappingsNow).toBe(false);
  });

  test('crash with resumable mappings prompts and keeps them until the user acts', () => {
    const mappings = [
      mapping({ terminalId: 'CC-1', agentType: 'claude' }),
      mapping({ terminalId: 'CX-1', agentType: 'codex' }),
    ];
    const plan = planRestore(false, mappings);
    expect(plan.shouldPrompt).toBe(true);
    expect(plan.toRestore).toHaveLength(2);
    expect(plan.clearMappingsNow).toBe(false);
  });

  test('mappings without a session id are filtered out (cannot resume a bare CLI)', () => {
    const mappings = [
      mapping({ terminalId: 'CC-1', sessionId: '4a78949e-0000-0000-0000-000000000000' }),
      mapping({ terminalId: 'CC-2', sessionId: '' }),
    ];
    const plan = planRestore(false, mappings);
    expect(plan.shouldPrompt).toBe(true);
    expect(plan.toRestore).toHaveLength(1);
    expect(plan.toRestore[0].terminalId).toBe('CC-1');
  });

  test('crash where no mapping is resumable clears silently instead of prompting', () => {
    const mappings = [
      mapping({ terminalId: 'CC-1', sessionId: '' }),
      // Corrupt/unknown agent type that survived deserialization.
      mapping({ terminalId: 'ZZ-1', agentType: 'bogus' as unknown as TerminalSessionMapping['agentType'] }),
    ];
    const plan = planRestore(false, mappings);
    expect(plan.shouldPrompt).toBe(false);
    expect(plan.toRestore).toHaveLength(0);
    expect(plan.clearMappingsNow).toBe(true);
  });
});
