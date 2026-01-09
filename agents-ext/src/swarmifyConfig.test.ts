import { describe, expect, test } from 'bun:test';
import {
  SWARMIFY_FILENAME,
  SwarmifyConfig,
  getDefaultConfig,
  parseSwarmifyConfig,
  serializeSwarmifyConfig,
  isValidMemorySource,
  isValidSymlinkTarget,
  isValidAgentId,
  getSymlinkTargetsForSource,
  getSourceFileName,
} from './swarmifyConfig';

describe('swarmifyConfig', () => {
  describe('constants', () => {
    test('SWARMIFY_FILENAME is .swarmify', () => {
      expect(SWARMIFY_FILENAME).toBe('.swarmify');
    });
  });

  describe('getDefaultConfig', () => {
    test('returns default config with AGENTS.md as source', () => {
      const config = getDefaultConfig();
      expect(config.memory.source).toBe('AGENTS.md');
    });

    test('returns default symlinks as CLAUDE.md and GEMINI.md', () => {
      const config = getDefaultConfig();
      expect(config.memory.symlinks).toEqual(['CLAUDE.md', 'GEMINI.md']);
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

  describe('isValidMemorySource', () => {
    test('returns true for AGENTS.md', () => {
      expect(isValidMemorySource('AGENTS.md')).toBe(true);
    });

    test('returns true for CLAUDE.md', () => {
      expect(isValidMemorySource('CLAUDE.md')).toBe(true);
    });

    test('returns true for GEMINI.md', () => {
      expect(isValidMemorySource('GEMINI.md')).toBe(true);
    });

    test('returns false for invalid source', () => {
      expect(isValidMemorySource('README.md')).toBe(false);
      expect(isValidMemorySource('agents.md')).toBe(false); // case sensitive
    });
  });

  describe('isValidSymlinkTarget', () => {
    test('returns true for valid targets', () => {
      expect(isValidSymlinkTarget('AGENTS.md')).toBe(true);
      expect(isValidSymlinkTarget('CLAUDE.md')).toBe(true);
      expect(isValidSymlinkTarget('GEMINI.md')).toBe(true);
    });

    test('returns false for invalid targets', () => {
      expect(isValidSymlinkTarget('README.md')).toBe(false);
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

    test('parses valid YAML config', () => {
      const yaml = `
memory:
  source: CLAUDE.md
  symlinks:
    - AGENTS.md
    - GEMINI.md
  symlinking: false
agents:
  - claude
  - codex
files:
  ralph: TASKS.md
  todo: TODOS.md
`;
      const config = parseSwarmifyConfig(yaml);
      expect(config.memory.source).toBe('CLAUDE.md');
      expect(config.memory.symlinks).toEqual(['AGENTS.md', 'GEMINI.md']);
      expect(config.memory.symlinking).toBe(false);
      expect(config.agents).toEqual(['claude', 'codex']);
      expect(config.files.ralph).toBe('TASKS.md');
      expect(config.files.todo).toBe('TODOS.md');
    });

    test('ignores invalid memory source and uses default', () => {
      const yaml = `
memory:
  source: invalid.md
`;
      const config = parseSwarmifyConfig(yaml);
      expect(config.memory.source).toBe('AGENTS.md'); // default
    });

    test('filters out invalid symlink targets', () => {
      const yaml = `
memory:
  symlinks:
    - CLAUDE.md
    - invalid.md
    - GEMINI.md
`;
      const config = parseSwarmifyConfig(yaml);
      expect(config.memory.symlinks).toEqual(['CLAUDE.md', 'GEMINI.md']);
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
  });

  describe('serializeSwarmifyConfig', () => {
    test('serializes config to valid YAML', () => {
      const config = getDefaultConfig();
      const yaml = serializeSwarmifyConfig(config);

      // Parse it back to verify
      const parsed = parseSwarmifyConfig(yaml);
      expect(parsed.memory.source).toBe(config.memory.source);
      expect(parsed.memory.symlinks).toEqual(config.memory.symlinks);
      expect(parsed.memory.symlinking).toBe(config.memory.symlinking);
      expect(parsed.agents).toEqual(config.agents);
      expect(parsed.files.ralph).toBe(config.files.ralph);
      expect(parsed.files.todo).toBe(config.files.todo);
    });

    test('serializes custom config correctly', () => {
      const config: SwarmifyConfig = {
        memory: {
          source: 'CLAUDE.md',
          symlinks: ['AGENTS.md'],
          symlinking: false,
        },
        agents: ['claude'],
        files: {
          ralph: 'TASKS.md',
          todo: 'TODOS.md',
        },
      };
      const yaml = serializeSwarmifyConfig(config);
      const parsed = parseSwarmifyConfig(yaml);

      expect(parsed.memory.source).toBe('CLAUDE.md');
      expect(parsed.memory.symlinks).toEqual(['AGENTS.md']);
      expect(parsed.memory.symlinking).toBe(false);
      expect(parsed.agents).toEqual(['claude']);
      expect(parsed.files.ralph).toBe('TASKS.md');
      expect(parsed.files.todo).toBe('TODOS.md');
    });
  });

  describe('getSymlinkTargetsForSource', () => {
    test('excludes source from symlink targets', () => {
      const config: SwarmifyConfig = {
        memory: {
          source: 'AGENTS.md',
          symlinks: ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'],
          symlinking: true,
        },
        agents: ['claude'],
        files: { ralph: 'RALPH.md', todo: 'TODO.md' },
      };
      const targets = getSymlinkTargetsForSource(config);
      expect(targets).toEqual(['CLAUDE.md', 'GEMINI.md']);
      expect(targets).not.toContain('AGENTS.md');
    });

    test('returns all symlinks when source is not in symlinks', () => {
      const config = getDefaultConfig();
      // Default: source=AGENTS.md, symlinks=[CLAUDE.md, GEMINI.md]
      const targets = getSymlinkTargetsForSource(config);
      expect(targets).toEqual(['CLAUDE.md', 'GEMINI.md']);
    });
  });

  describe('getSourceFileName', () => {
    test('returns memory source from config', () => {
      const config = getDefaultConfig();
      expect(getSourceFileName(config)).toBe('AGENTS.md');
    });

    test('returns custom source from config', () => {
      const config: SwarmifyConfig = {
        memory: {
          source: 'CLAUDE.md',
          symlinks: ['AGENTS.md'],
          symlinking: true,
        },
        agents: ['claude'],
        files: { ralph: 'RALPH.md', todo: 'TODO.md' },
      };
      expect(getSourceFileName(config)).toBe('CLAUDE.md');
    });
  });
});
