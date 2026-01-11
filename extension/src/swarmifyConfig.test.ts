import { describe, expect, test } from 'bun:test';
import {
  SWARMIFY_FILENAME,
  SwarmifyConfig,
  getDefaultConfig,
  parseSwarmifyConfig,
  serializeSwarmifyConfig,
  isValidAgentId,
  getSymlinkMappings,
  getPatterns,
  getSymlinksForPattern,
} from './swarmifyConfig';

describe('swarmifyConfig', () => {
  describe('constants', () => {
    test('SWARMIFY_FILENAME is .swarmify', () => {
      expect(SWARMIFY_FILENAME).toBe('.swarmify');
    });
  });

  describe('getDefaultConfig', () => {
    test('returns default config with AGENTS.md pattern', () => {
      const config = getDefaultConfig();
      expect(config.memory.files[0].pattern).toBe('AGENTS.md');
    });

    test('returns default symlinks as CLAUDE.md and GEMINI.md', () => {
      const config = getDefaultConfig();
      expect(config.memory.files[0].symlinks).toEqual(['CLAUDE.md', 'GEMINI.md']);
    });

    test('returns symlinking enabled by default', () => {
      const config = getDefaultConfig();
      expect(config.memory.symlinking).toBe(true);
    });

    test('returns default agents as claude, codex, gemini', () => {
      const config = getDefaultConfig();
      expect(config.agents).toEqual(['claude', 'codex', 'gemini']);
    });

    test('returns default ralph filename as RALPH.md', () => {
      const config = getDefaultConfig();
      expect(config.files.ralph).toBe('RALPH.md');
    });

    test('returns default todo filename as TODO.md', () => {
      const config = getDefaultConfig();
      expect(config.files.todo).toBe('TODO.md');
    });
  });

  describe('isValidAgentId', () => {
    test('returns true for valid agent ids', () => {
      expect(isValidAgentId('claude')).toBe(true);
      expect(isValidAgentId('codex')).toBe(true);
      expect(isValidAgentId('gemini')).toBe(true);
      expect(isValidAgentId('cursor')).toBe(true);
      expect(isValidAgentId('opencode')).toBe(true);
    });

    test('returns false for invalid agent ids', () => {
      expect(isValidAgentId('gpt')).toBe(false);
      expect(isValidAgentId('Claude')).toBe(false); // case sensitive
    });
  });

  describe('parseSwarmifyConfig', () => {
    test('returns defaults for empty string', () => {
      const config = parseSwarmifyConfig('');
      expect(config).toEqual(getDefaultConfig());
    });

    test('returns defaults for whitespace-only string', () => {
      const config = parseSwarmifyConfig('   \n\t  ');
      expect(config).toEqual(getDefaultConfig());
    });

    test('parses new format YAML config', () => {
      const yaml = `
memory:
  symlinking: false
  files:
    - pattern: CLAUDE.md
      symlinks:
        - AGENTS.md
        - GEMINI.md
agents:
  - claude
  - codex
files:
  ralph: TASKS.md
  todo: TODOS.md
`;
      const config = parseSwarmifyConfig(yaml);
      expect(config.memory.files[0].pattern).toBe('CLAUDE.md');
      expect(config.memory.files[0].symlinks).toEqual(['AGENTS.md', 'GEMINI.md']);
      expect(config.memory.symlinking).toBe(false);
      expect(config.agents).toEqual(['claude', 'codex']);
      expect(config.files.ralph).toBe('TASKS.md');
      expect(config.files.todo).toBe('TODOS.md');
    });

    test('parses legacy format and migrates to new format', () => {
      const yaml = `
memory:
  source: CLAUDE.md
  symlinks:
    - AGENTS.md
    - GEMINI.md
  symlinking: false
`;
      const config = parseSwarmifyConfig(yaml);
      // Legacy format should be migrated to new format
      expect(config.memory.files[0].pattern).toBe('CLAUDE.md');
      expect(config.memory.files[0].symlinks).toEqual(['AGENTS.md', 'GEMINI.md']);
      expect(config.memory.symlinking).toBe(false);
    });

    test('parses multiple file mappings', () => {
      const yaml = `
memory:
  symlinking: true
  files:
    - pattern: AGENTS.md
      symlinks:
        - CLAUDE.md
    - pattern: TASKS.md
      symlinks:
        - TASKS_CLAUDE.md
        - TASKS_GEMINI.md
`;
      const config = parseSwarmifyConfig(yaml);
      expect(config.memory.files).toHaveLength(2);
      expect(config.memory.files[0].pattern).toBe('AGENTS.md');
      expect(config.memory.files[0].symlinks).toEqual(['CLAUDE.md']);
      expect(config.memory.files[1].pattern).toBe('TASKS.md');
      expect(config.memory.files[1].symlinks).toEqual(['TASKS_CLAUDE.md', 'TASKS_GEMINI.md']);
    });

    test('filters out invalid agent ids', () => {
      const yaml = `
agents:
  - claude
  - invalid
  - codex
`;
      const config = parseSwarmifyConfig(yaml);
      expect(config.agents).toEqual(['claude', 'codex']);
    });

    test('uses defaults for empty agents array', () => {
      const yaml = `
agents: []
`;
      const config = parseSwarmifyConfig(yaml);
      expect(config.agents).toEqual(['claude', 'codex', 'gemini']); // default
    });

    test('trims file names', () => {
      const yaml = `
files:
  ralph: "  TASKS.md  "
  todo: "  TODOS.md  "
`;
      const config = parseSwarmifyConfig(yaml);
      expect(config.files.ralph).toBe('TASKS.md');
      expect(config.files.todo).toBe('TODOS.md');
    });

    test('uses defaults for empty file names', () => {
      const yaml = `
files:
  ralph: ""
  todo: "   "
`;
      const config = parseSwarmifyConfig(yaml);
      expect(config.files.ralph).toBe('RALPH.md'); // default
      expect(config.files.todo).toBe('TODO.md'); // default
    });

    test('trims patterns and symlinks', () => {
      const yaml = `
memory:
  files:
    - pattern: "  AGENTS.md  "
      symlinks:
        - "  CLAUDE.md  "
`;
      const config = parseSwarmifyConfig(yaml);
      expect(config.memory.files[0].pattern).toBe('AGENTS.md');
      expect(config.memory.files[0].symlinks).toEqual(['CLAUDE.md']);
    });
  });

  describe('serializeSwarmifyConfig', () => {
    test('serializes config to valid YAML', () => {
      const config = getDefaultConfig();
      const yaml = serializeSwarmifyConfig(config);

      // Parse it back to verify
      const parsed = parseSwarmifyConfig(yaml);
      expect(parsed.memory.files).toEqual(config.memory.files);
      expect(parsed.memory.symlinking).toBe(config.memory.symlinking);
      expect(parsed.agents).toEqual(config.agents);
      expect(parsed.files.ralph).toBe(config.files.ralph);
      expect(parsed.files.todo).toBe(config.files.todo);
    });

    test('serializes custom config correctly', () => {
      const config: SwarmifyConfig = {
        memory: {
          symlinking: false,
          files: [
            { pattern: 'CLAUDE.md', symlinks: ['AGENTS.md'] },
          ],
        },
        agents: ['claude'],
        files: {
          ralph: 'TASKS.md',
          todo: 'TODOS.md',
        },
      };
      const yaml = serializeSwarmifyConfig(config);
      const parsed = parseSwarmifyConfig(yaml);

      expect(parsed.memory.files[0].pattern).toBe('CLAUDE.md');
      expect(parsed.memory.files[0].symlinks).toEqual(['AGENTS.md']);
      expect(parsed.memory.symlinking).toBe(false);
      expect(parsed.agents).toEqual(['claude']);
      expect(parsed.files.ralph).toBe('TASKS.md');
      expect(parsed.files.todo).toBe('TODOS.md');
    });
  });

  describe('getSymlinkMappings', () => {
    test('returns all file mappings', () => {
      const config: SwarmifyConfig = {
        memory: {
          symlinking: true,
          files: [
            { pattern: 'AGENTS.md', symlinks: ['CLAUDE.md', 'GEMINI.md'] },
            { pattern: 'TASKS.md', symlinks: ['TASKS_CLAUDE.md'] },
          ],
        },
        agents: ['claude'],
        files: { ralph: 'RALPH.md', todo: 'TODO.md' },
      };
      const mappings = getSymlinkMappings(config);
      expect(mappings).toHaveLength(2);
      expect(mappings[0].pattern).toBe('AGENTS.md');
      expect(mappings[1].pattern).toBe('TASKS.md');
    });
  });

  describe('getPatterns', () => {
    test('returns all patterns from config', () => {
      const config: SwarmifyConfig = {
        memory: {
          symlinking: true,
          files: [
            { pattern: 'AGENTS.md', symlinks: ['CLAUDE.md'] },
            { pattern: 'TASKS.md', symlinks: ['TASKS_CLAUDE.md'] },
          ],
        },
        agents: ['claude'],
        files: { ralph: 'RALPH.md', todo: 'TODO.md' },
      };
      const patterns = getPatterns(config);
      expect(patterns).toEqual(['AGENTS.md', 'TASKS.md']);
    });
  });

  describe('getSymlinksForPattern', () => {
    test('returns symlinks for a specific pattern', () => {
      const config: SwarmifyConfig = {
        memory: {
          symlinking: true,
          files: [
            { pattern: 'AGENTS.md', symlinks: ['CLAUDE.md', 'GEMINI.md'] },
            { pattern: 'TASKS.md', symlinks: ['TASKS_CLAUDE.md'] },
          ],
        },
        agents: ['claude'],
        files: { ralph: 'RALPH.md', todo: 'TODO.md' },
      };
      expect(getSymlinksForPattern(config, 'AGENTS.md')).toEqual(['CLAUDE.md', 'GEMINI.md']);
      expect(getSymlinksForPattern(config, 'TASKS.md')).toEqual(['TASKS_CLAUDE.md']);
    });

    test('returns empty array for unknown pattern', () => {
      const config = getDefaultConfig();
      expect(getSymlinksForPattern(config, 'UNKNOWN.md')).toEqual([]);
    });
  });
});
