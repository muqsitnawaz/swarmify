import { describe, test, expect } from 'bun:test';
import {
  countRunningFromNames,
  generateTerminalId,
  buildAgentTerminalEnv,
  RunningCounts
} from './terminals';
import { CLAUDE_TITLE, CODEX_TITLE, GEMINI_TITLE, OPENCODE_TITLE, CURSOR_TITLE, SHELL_TITLE } from './utils';

describe('generateTerminalId', () => {
  test('creates id with prefix and counter', () => {
    const id = generateTerminalId('cc', 1);
    expect(id).toMatch(/^cc-\d+-1$/);
  });

  test('creates id with different prefix', () => {
    const id = generateTerminalId('cx', 5);
    expect(id).toMatch(/^cx-\d+-5$/);
  });

  test('includes timestamp', () => {
    const before = Date.now();
    const id = generateTerminalId('gm', 1);
    const after = Date.now();

    const parts = id.split('-');
    const timestamp = parseInt(parts[1], 10);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });
});

describe('countRunningFromNames', () => {
  test('counts zero for empty array', () => {
    const counts = countRunningFromNames([]);
    expect(counts.claude).toBe(0);
    expect(counts.codex).toBe(0);
    expect(counts.gemini).toBe(0);
    expect(counts.opencode).toBe(0);
    expect(counts.cursor).toBe(0);
    expect(counts.shell).toBe(0);
    expect(Object.keys(counts.custom)).toHaveLength(0);
  });

  test('counts claude terminals', () => {
    const counts = countRunningFromNames([CLAUDE_TITLE, CLAUDE_TITLE, 'bash']);
    expect(counts.claude).toBe(2);
    expect(counts.codex).toBe(0);
  });

  test('counts codex terminals', () => {
    const counts = countRunningFromNames([CODEX_TITLE, CODEX_TITLE, CODEX_TITLE]);
    expect(counts.codex).toBe(3);
  });

  test('counts gemini terminals', () => {
    const counts = countRunningFromNames([GEMINI_TITLE]);
    expect(counts.gemini).toBe(1);
  });

  test('counts opencode terminals', () => {
    const counts = countRunningFromNames([OPENCODE_TITLE, OPENCODE_TITLE]);
    expect(counts.opencode).toBe(2);
  });

  test('counts cursor terminals', () => {
    const counts = countRunningFromNames([CURSOR_TITLE, CURSOR_TITLE]);
    expect(counts.cursor).toBe(2);
  });

  test('counts mixed agents', () => {
    const counts = countRunningFromNames([
      CLAUDE_TITLE,
      CODEX_TITLE,
      GEMINI_TITLE,
      OPENCODE_TITLE,
      CURSOR_TITLE,
      CLAUDE_TITLE,
      SHELL_TITLE
    ]);
    expect(counts.claude).toBe(2);
    expect(counts.codex).toBe(1);
    expect(counts.gemini).toBe(1);
    expect(counts.opencode).toBe(1);
    expect(counts.cursor).toBe(1);
    expect(counts.shell).toBe(1);
  });

  test('ignores non-agent terminals', () => {
    const counts = countRunningFromNames(['bash', 'zsh', 'powershell']);
    expect(counts.claude).toBe(0);
    expect(counts.codex).toBe(0);
    expect(counts.gemini).toBe(0);
    expect(counts.opencode).toBe(0);
    expect(counts.cursor).toBe(0);
    expect(counts.shell).toBe(0);
  });

  test('handles terminals with labels', () => {
    const counts = countRunningFromNames([
      `${CLAUDE_TITLE} - auth feature`,
      `${CODEX_TITLE} - database work`
    ]);
    expect(counts.claude).toBe(1);
    expect(counts.codex).toBe(1);
  });
});

describe('buildAgentTerminalEnv', () => {
  test('includes AGENT_SESSION_ID when provided', () => {
    const env = buildAgentTerminalEnv('CC-123', 'session-abc');
    expect(env.AGENT_TERMINAL_ID).toBe('CC-123');
    expect(env.AGENT_SESSION_ID).toBe('session-abc');
    expect(env.AGENT_WORKSPACE_DIR).toBe('');
    expect(env.DISABLE_AUTO_TITLE).toBe('true');
    expect(env.PROMPT_COMMAND).toBe('');
  });

  test('uses empty AGENT_SESSION_ID when missing', () => {
    const env = buildAgentTerminalEnv('CC-123', null);
    expect(env.AGENT_TERMINAL_ID).toBe('CC-123');
    expect(env.AGENT_SESSION_ID).toBe('');
    expect(env.AGENT_WORKSPACE_DIR).toBe('');
  });

  test('includes AGENT_WORKSPACE_DIR when provided', () => {
    const env = buildAgentTerminalEnv('CC-123', 'session-abc', '/path/to/workspace');
    expect(env.AGENT_TERMINAL_ID).toBe('CC-123');
    expect(env.AGENT_SESSION_ID).toBe('session-abc');
    expect(env.AGENT_WORKSPACE_DIR).toBe('/path/to/workspace');
  });

  test('uses empty AGENT_WORKSPACE_DIR when null', () => {
    const env = buildAgentTerminalEnv('CC-123', null, null);
    expect(env.AGENT_WORKSPACE_DIR).toBe('');
  });
});
