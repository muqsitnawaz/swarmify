import {
  buildAgentTerminalEnv,
  generateTerminalId,
  countRunningFromNames
} from '../src/core/terminals';

describe('terminals core functions', () => {
  describe('buildAgentTerminalEnv', () => {
    test('includes AGENT_TERMINAL_ID', () => {
      const env = buildAgentTerminalEnv('CC-123-1', 'session-abc');
      expect(env.AGENT_TERMINAL_ID).toBe('CC-123-1');
    });

    test('includes AGENT_SESSION_ID when provided', () => {
      const env = buildAgentTerminalEnv('CC-123-1', 'session-abc');
      expect(env.AGENT_SESSION_ID).toBe('session-abc');
    });

    test('sets AGENT_SESSION_ID to empty string when null', () => {
      const env = buildAgentTerminalEnv('CC-123-1', null);
      expect(env.AGENT_SESSION_ID).toBe('');
    });

    test('sets AGENT_SESSION_ID to empty string when undefined', () => {
      const env = buildAgentTerminalEnv('CC-123-1', undefined);
      expect(env.AGENT_SESSION_ID).toBe('');
    });

    test('includes DISABLE_AUTO_TITLE', () => {
      const env = buildAgentTerminalEnv('CC-123-1', null);
      expect(env.DISABLE_AUTO_TITLE).toBe('true');
    });

    test('includes empty PROMPT_COMMAND', () => {
      const env = buildAgentTerminalEnv('CC-123-1', null);
      expect(env.PROMPT_COMMAND).toBe('');
    });
  });

  describe('generateTerminalId', () => {
    test('includes prefix', () => {
      const id = generateTerminalId('CC', 1);
      expect(id.startsWith('CC-')).toBe(true);
    });

    test('includes counter', () => {
      const id = generateTerminalId('CC', 42);
      expect(id.endsWith('-42')).toBe(true);
    });

    test('includes timestamp between prefix and counter', () => {
      const before = Date.now();
      const id = generateTerminalId('CC', 1);
      const after = Date.now();

      const parts = id.split('-');
      expect(parts.length).toBe(3);

      const timestamp = parseInt(parts[1], 10);
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });

    test('generates unique IDs for different counters', () => {
      const id1 = generateTerminalId('CC', 1);
      const id2 = generateTerminalId('CC', 2);
      expect(id1).not.toBe(id2);
    });
  });

  describe('countRunningFromNames', () => {
    test('counts Claude terminals', () => {
      // Note: 'CC abc12345' has 8-char session chunk, 'CC abc123' (7 chars) is not recognized
      const counts = countRunningFromNames(['CC', 'CC - task1', 'CC a1b2c3d4']);
      expect(counts.claude).toBe(3);
    });

    test('counts Codex terminals', () => {
      const counts = countRunningFromNames(['CX', 'CX - task']);
      expect(counts.codex).toBe(2);
    });

    test('counts Gemini terminals', () => {
      const counts = countRunningFromNames(['GX', 'GX - task']);
      expect(counts.gemini).toBe(2);
    });

    test('counts Cursor terminals', () => {
      const counts = countRunningFromNames(['CR', 'CR - task']);
      expect(counts.cursor).toBe(2);
    });

    test('counts Shell terminals', () => {
      const counts = countRunningFromNames(['SH', 'SH - task']);
      expect(counts.shell).toBe(2);
    });

    test('counts mixed agent types', () => {
      const counts = countRunningFromNames(['CC', 'CX', 'GX', 'CC - task', 'zsh']);
      expect(counts.claude).toBe(2);
      expect(counts.codex).toBe(1);
      expect(counts.gemini).toBe(1);
    });

    test('ignores non-agent terminals', () => {
      const counts = countRunningFromNames(['zsh', 'bash', 'node', 'python']);
      expect(counts.claude).toBe(0);
      expect(counts.codex).toBe(0);
      expect(counts.gemini).toBe(0);
      expect(counts.cursor).toBe(0);
      expect(counts.shell).toBe(0);
    });

    test('returns zeros for empty input', () => {
      const counts = countRunningFromNames([]);
      expect(counts.claude).toBe(0);
      expect(counts.codex).toBe(0);
      expect(counts.gemini).toBe(0);
      expect(counts.cursor).toBe(0);
      expect(counts.shell).toBe(0);
      expect(counts.opencode).toBe(0);
    });
  });
});
