// Pure functions for .agents config parsing/validation (no VS Code dependencies)

import * as YAML from 'yaml';

export const AGENTS_CONFIG_FILENAME = '.agents';

export type AgentId = 'claude' | 'codex' | 'gemini' | 'cursor' | 'opencode';

// Context mapping: source file and its aliases
export interface ContextMapping {
  source: string;    // source file (e.g., 'AGENTS.md')
  aliases: string[]; // agent-specific aliases (e.g., ['CLAUDE.md', 'GEMINI.md'])
}

export interface TasksConfig {
  ralph: string;
  todo: string;
}

export interface AgentsConfig {
  context: ContextMapping[];
  agents: AgentId[];
  tasks: TasksConfig;
}

const VALID_AGENT_IDS: AgentId[] = ['claude', 'codex', 'gemini', 'cursor', 'opencode'];

export function getDefaultConfig(): AgentsConfig {
  return {
    context: [
      {
        source: 'AGENTS.md',
        aliases: ['CLAUDE.md', 'GEMINI.md'],
      },
    ],
    agents: ['claude', 'codex', 'gemini'],
    tasks: {
      ralph: 'RALPH.md',
      todo: 'TODO.md',
    },
  };
}

export function isValidAgentId(value: string): value is AgentId {
  return VALID_AGENT_IDS.includes(value as AgentId);
}

export function parseAgentsConfig(yamlContent: string): AgentsConfig {
  const defaults = getDefaultConfig();

  if (!yamlContent.trim()) {
    return defaults;
  }

  const parsed = YAML.parse(yamlContent) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object') {
    return defaults;
  }

  const config: AgentsConfig = { ...defaults };

  // Parse context config
  if (Array.isArray(parsed.context)) {
    const validContext: ContextMapping[] = [];
    for (const item of parsed.context) {
      if (item && typeof item === 'object') {
        const c = item as Record<string, unknown>;
        if (typeof c.source === 'string' && c.source.trim()) {
          const aliases = Array.isArray(c.aliases)
            ? c.aliases
                .filter((a): a is string => typeof a === 'string' && a.trim() !== '')
                .map(a => a.trim())
            : [];
          validContext.push({
            source: c.source.trim(),
            aliases,
          });
        }
      }
    }
    config.context = validContext.length > 0 ? validContext : defaults.context;
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

  // Parse tasks config
  if (parsed.tasks && typeof parsed.tasks === 'object') {
    const tasks = parsed.tasks as Record<string, unknown>;

    if (typeof tasks.ralph === 'string' && tasks.ralph.trim()) {
      config.tasks.ralph = tasks.ralph.trim();
    }

    if (typeof tasks.todo === 'string' && tasks.todo.trim()) {
      config.tasks.todo = tasks.todo.trim();
    }
  }

  return config;
}

export function serializeAgentsConfig(config: AgentsConfig): string {
  const doc = new YAML.Document({
    context: config.context.map(c => ({
      source: c.source,
      aliases: c.aliases,
    })),
    agents: config.agents,
    tasks: {
      ralph: config.tasks.ralph,
      todo: config.tasks.todo,
    },
  });

  return doc.toString();
}

// Get all context mappings from the config
export function getContextMappings(config: AgentsConfig): ContextMapping[] {
  return config.context;
}

// Get all source files from the config
export function getSourceFiles(config: AgentsConfig): string[] {
  return config.context.map(c => c.source);
}

// Get aliases for a specific source file
export function getAliasesForSource(config: AgentsConfig, source: string): string[] {
  const mapping = config.context.find(c => c.source === source);
  return mapping ? mapping.aliases : [];
}

// --- Legacy compatibility exports ---
// These maintain backward compatibility during the transition

/** @deprecated Use AgentsConfig */
export type SwarmifyConfig = AgentsConfig;

/** @deprecated Use ContextMapping */
export interface MemoryFileMapping {
  pattern: string;
  symlinks: string[];
}

/** @deprecated Use AgentsConfig.tasks */
export interface FilesConfig {
  ralph: string;
  todo: string;
}

/** @deprecated Use AgentsConfig.context */
export interface MemoryConfig {
  symlinking: boolean;
  files: MemoryFileMapping[];
}

/** @deprecated Use parseAgentsConfig */
export function parseSwarmifyConfig(yamlContent: string): AgentsConfig {
  return parseAgentsConfig(yamlContent);
}

/** @deprecated Use serializeAgentsConfig */
export function serializeSwarmifyConfig(config: AgentsConfig): string {
  return serializeAgentsConfig(config);
}

/** @deprecated Use getContextMappings */
export function getSymlinkMappings(config: AgentsConfig): ContextMapping[] {
  return config.context;
}

/** @deprecated Use getSourceFiles */
export function getPatterns(config: AgentsConfig): string[] {
  return config.context.map(c => c.source);
}

/** @deprecated Use getAliasesForSource */
export function getSymlinksForPattern(config: AgentsConfig, pattern: string): string[] {
  return getAliasesForSource(config, pattern);
}

// For backward compat with old field names - map new to old
export function toLegacyFormat(config: AgentsConfig): {
  memory: MemoryConfig;
  agents: AgentId[];
  files: FilesConfig;
} {
  return {
    memory: {
      symlinking: true,
      files: config.context.map(c => ({
        pattern: c.source,
        symlinks: c.aliases,
      })),
    },
    agents: config.agents,
    files: config.tasks,
  };
}
