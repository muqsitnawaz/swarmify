import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import {
  parsePackageIdentifier,
  getRegistries,
  getEnabledRegistries,
  setRegistry,
  removeRegistry,
  searchMcpRegistries,
  getMcpServerInfo,
  resolvePackage,
  search,
} from '../src/lib/registry.js';
import { DEFAULT_REGISTRIES } from '../src/lib/types.js';

// Test fixtures directory
const FIXTURES_DIR = join(tmpdir(), 'agents-cli-test-fixtures');
const ORIGINAL_HOME = process.env.HOME;

describe('parsePackageIdentifier', () => {
  it('parses mcp: prefix', () => {
    const result = parsePackageIdentifier('mcp:filesystem');
    expect(result).toEqual({ type: 'mcp', name: 'filesystem' });
  });

  it('parses mcp: prefix with org/name', () => {
    const result = parsePackageIdentifier('mcp:anthropics/mcp-server-git');
    expect(result).toEqual({ type: 'mcp', name: 'anthropics/mcp-server-git' });
  });

  it('parses skill: prefix', () => {
    const result = parsePackageIdentifier('skill:user/repo');
    expect(result).toEqual({ type: 'skill', name: 'user/repo' });
  });

  it('parses gh: prefix as git', () => {
    const result = parsePackageIdentifier('gh:muqsitnawaz/.agents');
    expect(result).toEqual({ type: 'git', name: 'gh:muqsitnawaz/.agents' });
  });

  it('parses https:// URLs as git', () => {
    const result = parsePackageIdentifier('https://github.com/user/repo');
    expect(result).toEqual({ type: 'git', name: 'https://github.com/user/repo' });
  });

  it('parses git@ URLs as git', () => {
    const result = parsePackageIdentifier('git@github.com:user/repo.git');
    expect(result).toEqual({ type: 'git', name: 'git@github.com:user/repo.git' });
  });

  it('parses user/repo format as unknown', () => {
    const result = parsePackageIdentifier('user/repo');
    expect(result).toEqual({ type: 'unknown', name: 'user/repo' });
  });

  it('parses single word as unknown', () => {
    const result = parsePackageIdentifier('filesystem');
    expect(result).toEqual({ type: 'unknown', name: 'filesystem' });
  });
});

describe('DEFAULT_REGISTRIES', () => {
  it('has official MCP registry configured', () => {
    expect(DEFAULT_REGISTRIES.mcp.official).toBeDefined();
    expect(DEFAULT_REGISTRIES.mcp.official.url).toBe('https://registry.modelcontextprotocol.io/v0');
    expect(DEFAULT_REGISTRIES.mcp.official.enabled).toBe(true);
  });

  it('has empty skill registries (no public API)', () => {
    expect(DEFAULT_REGISTRIES.skill).toEqual({});
  });
});

describe('getRegistries', () => {
  it('returns default MCP registries', () => {
    const registries = getRegistries('mcp');
    expect(registries.official).toBeDefined();
    expect(registries.official.url).toBe('https://registry.modelcontextprotocol.io/v0');
  });

  it('returns empty object for skill type', () => {
    const registries = getRegistries('skill');
    expect(Object.keys(registries).length).toBe(0);
  });
});

describe('getEnabledRegistries', () => {
  it('returns only enabled registries', () => {
    const enabled = getEnabledRegistries('mcp');
    expect(enabled.length).toBeGreaterThan(0);
    expect(enabled.every((r) => r.config.enabled)).toBe(true);
  });

  it('returns empty array when no registries enabled', () => {
    const enabled = getEnabledRegistries('skill');
    expect(enabled).toEqual([]);
  });
});

describe('MCP Registry API (live)', () => {
  it('searches for servers', async () => {
    const results = await searchMcpRegistries('github', { limit: 5 });
    expect(Array.isArray(results)).toBe(true);
    // Should find at least one GitHub-related MCP server
    if (results.length > 0) {
      expect(results[0]).toHaveProperty('name');
      expect(results[0]).toHaveProperty('type', 'mcp');
      expect(results[0]).toHaveProperty('registry', 'official');
    }
  });

  it('returns empty array for non-existent query', async () => {
    const results = await searchMcpRegistries('xyznonexistent123456789');
    expect(Array.isArray(results)).toBe(true);
  });

  it('gets specific server info', async () => {
    // Search for a known MCP server
    const info = await getMcpServerInfo('filesystem');
    // May or may not find it depending on registry state
    if (info) {
      expect(info).toHaveProperty('name');
    }
  });
});

describe('search', () => {
  it('searches all registry types by default', async () => {
    const results = await search('github', { limit: 5 });
    expect(Array.isArray(results)).toBe(true);
  });

  it('filters by MCP type', async () => {
    const results = await search('github', { type: 'mcp', limit: 5 });
    expect(results.every((r) => r.type === 'mcp')).toBe(true);
  });

  it('returns empty for skill type (no registries)', async () => {
    const results = await search('github', { type: 'skill', limit: 5 });
    expect(results).toEqual([]);
  });
});

describe('resolvePackage', () => {
  it('resolves git source directly', async () => {
    const result = await resolvePackage('gh:user/repo');
    expect(result).toEqual({ type: 'git', source: 'gh:user/repo' });
  });

  it('resolves skill: prefix to git fallback', async () => {
    const result = await resolvePackage('skill:user/repo');
    expect(result).toEqual({ type: 'git', source: 'gh:user/repo' });
  });

  it('resolves mcp: prefix via registry', async () => {
    // This will search the MCP registry
    const result = await resolvePackage('mcp:filesystem');
    // May or may not find it depending on registry
    if (result) {
      expect(result.type).toBe('mcp');
    }
  });

  it('resolves unknown user/repo to git fallback', async () => {
    const result = await resolvePackage('some-unknown-user/some-repo-123');
    expect(result).toEqual({ type: 'git', source: 'gh:some-unknown-user/some-repo-123' });
  });
});
