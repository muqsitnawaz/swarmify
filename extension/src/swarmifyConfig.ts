// Pure functions for .swarmify config parsing/validation (no VS Code dependencies)

import * as YAML from 'yaml';

export const SWARMIFY_FILENAME = '.swarmify';

export type AgentId = 'claude' | 'codex' | 'gemini' | 'cursor' | 'opencode';

// New memory config structure with explicit pattern -> symlinks mapping
export interface MemoryFileMapping {
  pattern: string;      // source file (e.g., 'AGENTS.md')
  symlinks: string[];   // targets that will symlink to pattern (e.g., ['CLAUDE.md', 'GEMINI.md'])
}

export interface MemoryConfig {
  symlinking: boolean;
  files: MemoryFileMapping[];
}

export interface FilesConfig {
  ralph: string;
  todo: string;
}

export interface SwarmifyConfig {
  memory: MemoryConfig;
  agents: AgentId[];
  files: FilesConfig;
}

// Legacy types for backward compatibility during parsing
interface LegacyMemoryConfig {
  source?: string;
  symlinks?: string[];
  symlinking?: boolean;
}

const VALID_AGENT_IDS: AgentId[] = ['claude', 'codex', 'gemini', 'cursor', 'opencode'];

export function getDefaultConfig(): SwarmifyConfig {
  return {
    memory: {
      symlinking: true,
      files: [
        {
          pattern: 'AGENTS.md',
          symlinks: ['CLAUDE.md', 'GEMINI.md'],
        },
      ],
    },
    agents: ['claude', 'codex', 'gemini'],
    files: {
      ralph: 'RALPH.md',
      todo: 'TODO.md',
    },
  };
}

export function isValidAgentId(value: string): value is AgentId {
  return VALID_AGENT_IDS.includes(value as AgentId);
}

// Convert legacy config format to new format
function migrateLegacyMemoryConfig(legacy: LegacyMemoryConfig): MemoryConfig {
  const source = legacy.source || 'AGENTS.md';
  const symlinks = (legacy.symlinks || ['CLAUDE.md', 'GEMINI.md']).filter(s => s !== source);

  return {
    symlinking: legacy.symlinking !== false,
    files: symlinks.length > 0 ? [{ pattern: source, symlinks }] : [],
  };
}

export function parseSwarmifyConfig(yamlContent: string): SwarmifyConfig {
  const defaults = getDefaultConfig();

  if (!yamlContent.trim()) {
    return defaults;
  }

  const parsed = YAML.parse(yamlContent) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object') {
    return defaults;
  }

  const config: SwarmifyConfig = { ...defaults };

  // Parse memory config
  if (parsed.memory && typeof parsed.memory === 'object') {
    const mem = parsed.memory as Record<string, unknown>;

    // Check if this is the new format (has 'files' array) or legacy format (has 'source')
    if (Array.isArray(mem.files)) {
      // New format: memory.files is an array of {pattern, symlinks}
      const validFiles: MemoryFileMapping[] = [];
      for (const file of mem.files) {
        if (file && typeof file === 'object') {
          const f = file as Record<string, unknown>;
          if (typeof f.pattern === 'string' && f.pattern.trim()) {
            const symlinks = Array.isArray(f.symlinks)
              ? f.symlinks
                  .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
                  .map(s => s.trim())
              : [];
            validFiles.push({
              pattern: f.pattern.trim(),
              symlinks,
            });
          }
        }
      }
      config.memory.files = validFiles.length > 0 ? validFiles : defaults.memory.files;

      if (typeof mem.symlinking === 'boolean') {
        config.memory.symlinking = mem.symlinking;
      }
    } else if (typeof mem.source === 'string') {
      // Legacy format: memory.source + memory.symlinks
      config.memory = migrateLegacyMemoryConfig(mem as LegacyMemoryConfig);
    }
  }

  // Parse agents
  if (Array.isArray(parsed.agents)) {
    const validAgents = parsed.agents.filter(
      (a): a is AgentId => typeof a === 'string' && isValidAgentId(a)
    );
    if (validAgents.length > 0) {
      config.agents = validAgents;
    }
  }

  // Parse files config
  if (parsed.files && typeof parsed.files === 'object') {
    const files = parsed.files as Record<string, unknown>;

    if (typeof files.ralph === 'string' && files.ralph.trim()) {
      config.files.ralph = files.ralph.trim();
    }

    if (typeof files.todo === 'string' && files.todo.trim()) {
      config.files.todo = files.todo.trim();
    }
  }

  return config;
}

export function serializeSwarmifyConfig(config: SwarmifyConfig): string {
  const doc = new YAML.Document({
    memory: {
      symlinking: config.memory.symlinking,
      files: config.memory.files.map(f => ({
        pattern: f.pattern,
        symlinks: f.symlinks,
      })),
    },
    agents: config.agents,
    files: {
      ralph: config.files.ralph,
      todo: config.files.todo,
    },
  });

  return doc.toString();
}

// Get all symlink mappings from the config
export function getSymlinkMappings(config: SwarmifyConfig): MemoryFileMapping[] {
  return config.memory.files;
}

// Get all patterns (source files) from the config
export function getPatterns(config: SwarmifyConfig): string[] {
  return config.memory.files.map(f => f.pattern);
}

// Get symlink targets for a specific pattern
export function getSymlinksForPattern(config: SwarmifyConfig, pattern: string): string[] {
  const mapping = config.memory.files.find(f => f.pattern === pattern);
  return mapping ? mapping.symlinks : [];
}
