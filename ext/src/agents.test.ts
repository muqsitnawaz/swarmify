import { describe, test, expect } from 'bun:test';
import {
  BUILT_IN_AGENTS,
  getBuiltInByKey,
  getBuiltInByPrefix
} from './agents';
import { CLAUDE_TITLE, CODEX_TITLE, GEMINI_TITLE, CURSOR_TITLE } from './utils';

describe('BUILT_IN_AGENTS', () => {
  test('has 4 built-in agents', () => {
    expect(BUILT_IN_AGENTS).toHaveLength(4);
  });

  test('claude agent has correct properties', () => {
    const claude = BUILT_IN_AGENTS.find(a => a.key === 'claude');
    expect(claude).toBeDefined();
    expect(claude!.title).toBe(CLAUDE_TITLE);
    expect(claude!.command).toBe('claude');
    expect(claude!.prefix).toBe('cc');
    expect(claude!.commandId).toBe('agents.newClaude');
  });

  test('all agents have required fields', () => {
    for (const agent of BUILT_IN_AGENTS) {
      expect(agent.key).toBeTruthy();
      expect(agent.title).toBeTruthy();
      expect(agent.command).toBeTruthy();
      expect(agent.icon).toMatch(/\.png$/);
      expect(agent.prefix).toBeTruthy();
      expect(agent.commandId).toMatch(/^agents\.new/);
    }
  });
});

describe('getBuiltInByKey', () => {
  test('returns claude agent', () => {
    const agent = getBuiltInByKey('claude');
    expect(agent).toBeDefined();
    expect(agent!.title).toBe(CLAUDE_TITLE);
  });

  test('returns codex agent', () => {
    const agent = getBuiltInByKey('codex');
    expect(agent).toBeDefined();
    expect(agent!.title).toBe(CODEX_TITLE);
  });

  test('returns gemini agent', () => {
    const agent = getBuiltInByKey('gemini');
    expect(agent).toBeDefined();
    expect(agent!.title).toBe(GEMINI_TITLE);
  });

  test('returns cursor agent', () => {
    const agent = getBuiltInByKey('cursor');
    expect(agent).toBeDefined();
    expect(agent!.title).toBe(CURSOR_TITLE);
  });

  test('returns undefined for unknown key', () => {
    const agent = getBuiltInByKey('unknown');
    expect(agent).toBeUndefined();
  });
});

describe('getBuiltInByPrefix', () => {
  test('returns claude for cc prefix', () => {
    const agent = getBuiltInByPrefix('cc');
    expect(agent).toBeDefined();
    expect(agent!.key).toBe('claude');
  });

  test('returns codex for cx prefix', () => {
    const agent = getBuiltInByPrefix('cx');
    expect(agent).toBeDefined();
    expect(agent!.key).toBe('codex');
  });

  test('returns gemini for gm prefix', () => {
    const agent = getBuiltInByPrefix('gm');
    expect(agent).toBeDefined();
    expect(agent!.key).toBe('gemini');
  });

  test('returns cursor for cr prefix', () => {
    const agent = getBuiltInByPrefix('cr');
    expect(agent).toBeDefined();
    expect(agent!.key).toBe('cursor');
  });

  test('returns undefined for unknown prefix', () => {
    const agent = getBuiltInByPrefix('xx');
    expect(agent).toBeUndefined();
  });
});
