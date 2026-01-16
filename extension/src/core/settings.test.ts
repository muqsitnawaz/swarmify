import { describe, test, expect } from 'bun:test';
import {
  getDefaultSettings,
  hasLoginEnabled,
  AgentSettings
} from './settings';

describe('getDefaultSettings', () => {
  test('returns valid settings structure', () => {
    const settings = getDefaultSettings();

    expect(settings.builtIn).toBeDefined();
    expect(settings.builtIn.claude).toBeDefined();
    expect(settings.builtIn.codex).toBeDefined();
    expect(settings.builtIn.gemini).toBeDefined();
    expect(settings.builtIn.opencode).toBeDefined();
    expect(settings.builtIn.cursor).toBeDefined();
    expect(settings.custom).toEqual([]);
    expect(settings.editor).toBeDefined();
    expect(settings.display).toBeDefined();
  });

  test('all built-in agents have login disabled by default', () => {
    const settings = getDefaultSettings();

    expect(settings.builtIn.claude.login).toBe(false);
    expect(settings.builtIn.codex.login).toBe(false);
    expect(settings.builtIn.gemini.login).toBe(false);
    expect(settings.builtIn.opencode.login).toBe(false);
    expect(settings.builtIn.cursor.login).toBe(false);
  });

  test('display preferences defaults', () => {
    const settings = getDefaultSettings();
    expect(settings.display.showFullAgentNames).toBe(true);
    expect(settings.display.showLabelsInTitles).toBe(true);
    expect(settings.display.showSessionIdInTitles).toBe(true);
  });

  test('all built-in agents have 2 instances by default', () => {
    const settings = getDefaultSettings();

    expect(settings.builtIn.claude.instances).toBe(2);
    expect(settings.builtIn.codex.instances).toBe(2);
    expect(settings.builtIn.gemini.instances).toBe(2);
    expect(settings.builtIn.opencode.instances).toBe(2);
    expect(settings.builtIn.cursor.instances).toBe(2);
  });

  test('editor preferences defaults', () => {
    const settings = getDefaultSettings();
    expect(settings.editor.markdownViewerEnabled).toBe(true);
  });
});

describe('hasLoginEnabled', () => {
  test('returns false for default settings', () => {
    const settings = getDefaultSettings();
    expect(hasLoginEnabled(settings)).toBe(false);
  });

  test('returns true when claude login is enabled', () => {
    const settings = getDefaultSettings();
    settings.builtIn.claude.login = true;
    expect(hasLoginEnabled(settings)).toBe(true);
  });

  test('returns true when codex login is enabled', () => {
    const settings = getDefaultSettings();
    settings.builtIn.codex.login = true;
    expect(hasLoginEnabled(settings)).toBe(true);
  });

  test('returns true when custom agent login is enabled', () => {
    const settings = getDefaultSettings();
    settings.custom.push({
      name: 'Custom',
      command: 'custom-cli',
      login: true,
      instances: 1
    });
    expect(hasLoginEnabled(settings)).toBe(true);
  });

  test('returns false when custom agent exists but login is disabled', () => {
    const settings = getDefaultSettings();
    settings.custom.push({
      name: 'Custom',
      command: 'custom-cli',
      login: false,
      instances: 1
    });
    expect(hasLoginEnabled(settings)).toBe(false);
  });
});
