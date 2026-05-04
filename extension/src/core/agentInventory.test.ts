import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  normalizeRunStrategy,
  readAgentRunStrategyFromConfig,
  setAgentRunStrategyInConfig,
  summarizeAgentInventory,
} from './agentInventory';

const FIXTURE_PATH = path.join(__dirname, 'testdata', 'view-claude.json');
const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'));

describe('agentInventory', () => {
  test('normalizes run strategy safely', () => {
    expect(normalizeRunStrategy('rotate')).toBe('rotate');
    expect(normalizeRunStrategy('available')).toBe('available');
    expect(normalizeRunStrategy('bogus')).toBe('pinned');
    expect(normalizeRunStrategy(undefined)).toBe('pinned');
  });

  test('reads run strategy from config', () => {
    expect(readAgentRunStrategyFromConfig({ run: { claude: { strategy: 'available' } } }, 'claude')).toBe('available');
    expect(readAgentRunStrategyFromConfig({ run: { claude: { strategy: 'bogus' } } }, 'claude')).toBe('pinned');
  });

  test('writes run strategy into config without clobbering siblings', () => {
    const next = setAgentRunStrategyInConfig({ defaults: { method: 'symlink' } }, 'claude', 'rotate');
    expect(next.defaults).toEqual({ method: 'symlink' });
    expect(readAgentRunStrategyFromConfig(next, 'claude')).toBe('rotate');
  });

  test('summarizes agent inventory from agents view json', () => {
    const summary = summarizeAgentInventory('claude', fixture, 'rotate');
    expect(summary.agent).toBe('claude');
    expect(summary.strategy).toBe('rotate');
    expect(summary.defaultVersion).toBe('2.1.112');
    expect(summary.defaultAccount).toBe('muqsitnawaz@gmail.com');
    expect(summary.signedInCount).toBeGreaterThan(1);
    expect(summary.canRotate).toBe(true);
    expect(summary.versions[0].sessionUsedPercent).toBe(19);
  });
});
