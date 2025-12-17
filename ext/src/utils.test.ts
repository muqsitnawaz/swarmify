import { describe, test, expect } from 'bun:test';
import {
  parseTerminalName,
  sanitizeLabel,
  getExpandedAgentName,
  getIconFilename,
  CLAUDE_TITLE,
  CODEX_TITLE,
  GEMINI_TITLE,
  CURSOR_TITLE
} from './utils';

describe('parseTerminalName', () => {
  test('identifies exact agent prefixes', () => {
    expect(parseTerminalName('CC')).toEqual({ isAgent: true, prefix: 'CC', label: null });
    expect(parseTerminalName('CX')).toEqual({ isAgent: true, prefix: 'CX', label: null });
    expect(parseTerminalName('GX')).toEqual({ isAgent: true, prefix: 'GX', label: null });
    expect(parseTerminalName('CR')).toEqual({ isAgent: true, prefix: 'CR', label: null });
  });

  test('identifies agent prefixes with labels', () => {
    expect(parseTerminalName('CC - auth feature')).toEqual({
      isAgent: true,
      prefix: 'CC',
      label: 'auth feature'
    });
    expect(parseTerminalName('CX - bug fix')).toEqual({
      isAgent: true,
      prefix: 'CX',
      label: 'bug fix'
    });
  });

  test('handles whitespace correctly', () => {
    expect(parseTerminalName('  CC  ')).toEqual({ isAgent: true, prefix: 'CC', label: null });
    expect(parseTerminalName('CC - label with spaces  ')).toEqual({
      isAgent: true,
      prefix: 'CC',
      label: 'label with spaces'
    });
  });

  test('rejects non-agent terminals', () => {
    expect(parseTerminalName('bash')).toEqual({ isAgent: false, prefix: null, label: null });
    expect(parseTerminalName('zsh')).toEqual({ isAgent: false, prefix: null, label: null });
    expect(parseTerminalName('node')).toEqual({ isAgent: false, prefix: null, label: null });
  });

  test('rejects partial matches (strict mode)', () => {
    // Should NOT match "cc" in lowercase
    expect(parseTerminalName('cc')).toEqual({ isAgent: false, prefix: null, label: null });
    // Should NOT match if prefix is part of larger word
    expect(parseTerminalName('success')).toEqual({ isAgent: false, prefix: null, label: null });
    expect(parseTerminalName('CCTools')).toEqual({ isAgent: false, prefix: null, label: null });
    // Should NOT match without proper separator
    expect(parseTerminalName('CC-label')).toEqual({ isAgent: false, prefix: null, label: null });
    expect(parseTerminalName('CClabel')).toEqual({ isAgent: false, prefix: null, label: null });
  });

  test('handles empty label after separator', () => {
    // "CC - " with empty trailing content is not a valid agent name pattern
    expect(parseTerminalName('CC - ')).toEqual({ isAgent: false, prefix: null, label: null });
  });
});

describe('sanitizeLabel', () => {
  test('removes quotes from input', () => {
    expect(sanitizeLabel('"auth feature"')).toBe('auth feature');
    expect(sanitizeLabel("'bug fix'")).toBe('bug fix');
    expect(sanitizeLabel('`code review`')).toBe('code review');
  });

  test('limits to max 5 words', () => {
    expect(sanitizeLabel('one two three four five six seven')).toBe('one two three four five');
  });

  test('handles empty and whitespace input', () => {
    expect(sanitizeLabel('')).toBe('');
    expect(sanitizeLabel('   ')).toBe('');
    expect(sanitizeLabel('  \t\n  ')).toBe('');
  });

  test('normalizes multiple spaces', () => {
    expect(sanitizeLabel('auth    feature')).toBe('auth feature');
  });
});

describe('getExpandedAgentName', () => {
  test('expands known prefixes', () => {
    expect(getExpandedAgentName(CLAUDE_TITLE)).toBe('Claude');
    expect(getExpandedAgentName(CODEX_TITLE)).toBe('Codex');
    expect(getExpandedAgentName(GEMINI_TITLE)).toBe('Gemini');
    expect(getExpandedAgentName(CURSOR_TITLE)).toBe('Cursor');
  });

  test('returns prefix as-is for unknown values', () => {
    expect(getExpandedAgentName('XX')).toBe('XX');
    expect(getExpandedAgentName('Custom')).toBe('Custom');
  });
});

describe('getIconFilename', () => {
  test('returns correct icon filenames', () => {
    expect(getIconFilename(CLAUDE_TITLE)).toBe('claude.png');
    expect(getIconFilename(CODEX_TITLE)).toBe('chatgpt.png');
    expect(getIconFilename(GEMINI_TITLE)).toBe('gemini.png');
    expect(getIconFilename(CURSOR_TITLE)).toBe('cursor.png');
  });

  test('returns null for unknown prefixes', () => {
    expect(getIconFilename('XX')).toBeNull();
    expect(getIconFilename('Custom')).toBeNull();
  });
});
