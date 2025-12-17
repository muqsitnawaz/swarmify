import { describe, test, expect } from 'bun:test';
import {
  getApiEndpoint,
  parseIgnorePatterns,
  shouldIgnoreFile,
  buildSystemPrompt,
  formatChangeStatus
} from './git';

describe('getApiEndpoint', () => {
  test('returns openai endpoint for openai provider', () => {
    expect(getApiEndpoint('openai')).toBe('https://api.openai.com/v1/chat/completions');
  });

  test('returns openrouter endpoint for openrouter provider', () => {
    expect(getApiEndpoint('openrouter')).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  test('returns custom URL if provider starts with http', () => {
    const customUrl = 'https://custom-api.example.com/v1/chat';
    expect(getApiEndpoint(customUrl)).toBe(customUrl);
  });

  test('returns openai endpoint as default', () => {
    expect(getApiEndpoint('unknown')).toBe('https://api.openai.com/v1/chat/completions');
  });
});

describe('parseIgnorePatterns', () => {
  test('returns empty array for empty string', () => {
    expect(parseIgnorePatterns('')).toEqual([]);
  });

  test('parses single pattern', () => {
    expect(parseIgnorePatterns('node_modules')).toEqual(['node_modules']);
  });

  test('parses multiple patterns', () => {
    expect(parseIgnorePatterns('node_modules,dist,build')).toEqual(['node_modules', 'dist', 'build']);
  });

  test('trims whitespace from patterns', () => {
    expect(parseIgnorePatterns('  node_modules  ,  dist  ')).toEqual(['node_modules', 'dist']);
  });

  test('filters out empty patterns', () => {
    expect(parseIgnorePatterns('node_modules,,dist,')).toEqual(['node_modules', 'dist']);
  });
});

describe('shouldIgnoreFile', () => {
  test('ignores files matching extension pattern', () => {
    expect(shouldIgnoreFile('/src/app.lock', ['*.lock'])).toBe(true);
    expect(shouldIgnoreFile('/src/bun.lock', ['*.lock'])).toBe(true);
  });

  test('does not ignore files not matching extension pattern', () => {
    expect(shouldIgnoreFile('/src/app.ts', ['*.lock'])).toBe(false);
  });

  test('ignores files in node_modules directory', () => {
    expect(shouldIgnoreFile('/node_modules/foo/bar.js', ['node_modules'])).toBe(true);
  });

  test('ignores dist directory', () => {
    expect(shouldIgnoreFile('/dist/bundle.js', ['dist'])).toBe(true);
  });

  test('does not ignore source files', () => {
    expect(shouldIgnoreFile('/src/app.ts', ['node_modules', 'dist'])).toBe(false);
  });

  test('handles multiple patterns', () => {
    const patterns = ['node_modules', '*.lock', 'dist'];
    expect(shouldIgnoreFile('/node_modules/pkg/index.js', patterns)).toBe(true);
    expect(shouldIgnoreFile('/bun.lock', patterns)).toBe(true);  // *.lock matches files ending in .lock
    expect(shouldIgnoreFile('/dist/out.js', patterns)).toBe(true);
    expect(shouldIgnoreFile('/src/main.ts', patterns)).toBe(false);
    expect(shouldIgnoreFile('/package-lock.json', patterns)).toBe(false);  // .json doesn't match *.lock
  });
});

describe('buildSystemPrompt', () => {
  test('returns base prompt without examples', () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toContain('helpful assistant');
    expect(prompt).toContain('commit messages');
    expect(prompt).not.toContain('examples');
  });

  test('includes examples when provided', () => {
    const prompt = buildSystemPrompt(['fix: bug fix', 'feat: new feature']);
    expect(prompt).toContain('2 examples');
    expect(prompt).toContain('fix: bug fix');
    expect(prompt).toContain('feat: new feature');
  });

  test('calculates max length from examples', () => {
    const prompt = buildSystemPrompt(['short', 'this is a much longer commit message example']);
    expect(prompt).toContain('no longer than');
  });
});

describe('formatChangeStatus', () => {
  test('formats new file status', () => {
    expect(formatChangeStatus(7, true)).toBe('Staged New');
    expect(formatChangeStatus(7, false)).toBe('Unstaged New');
  });

  test('formats modified file status', () => {
    expect(formatChangeStatus(5, true)).toBe('Staged Modified');
    expect(formatChangeStatus(5, false)).toBe('Unstaged Modified');
  });

  test('formats deleted file status', () => {
    expect(formatChangeStatus(6, true)).toBe('Staged Deleted');
    expect(formatChangeStatus(6, false)).toBe('Unstaged Deleted');
  });

  test('formats unknown status as Changed', () => {
    expect(formatChangeStatus(99, true)).toBe('Staged Changed');
    expect(formatChangeStatus(99, false)).toBe('Unstaged Changed');
  });
});
