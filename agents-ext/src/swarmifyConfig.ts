// Pure functions for .swarmify config parsing/validation (no VS Code dependencies)

import * as YAML from 'yaml';

export const SWARMIFY_FILENAME = '.swarmify';

export type MemorySource = 'AGENTS.md' | 'CLAUDE.md' | 'GEMINI.md';
export type SymlinkTarget = 'AGENTS.md' | 'CLAUDE.md' | 'GEMINI.md';
export type AgentId = 'claude' | 'codex' | 'gemini' | 'cursor' | 'opencode';

export interface MemoryConfig {
  source: MemorySource;
  symlinks: SymlinkTarget[];
  symlinking: boolean;
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

const VALID_MEMORY_SOURCES: MemorySource[] = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'];
const VALID_SYMLINK_TARGETS: SymlinkTarget[] = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'];
const VALID_AGENT_IDS: AgentId[] = ['claude', 'codex', 'gemini', 'cursor', 'opencode'];

export function getDefaultConfig(): SwarmifyConfig {
  return {
    memory: {
      source: 'AGENTS.md',
      symlinks: ['CLAUDE.md', 'GEMINI.md'],
      symlinking: true,
    },
    agents: ['claude', 'codex', 'gemini'],
    files: {
      ralph: 'RALPH.md',
      todo: 'TODO.md',
    },
  };
}

export function isValidMemorySource(value: string): value is MemorySource {
  return VALID_MEMORY_SOURCES.includes(value as MemorySource);
}

export function isValidSymlinkTarget(value: string): value is SymlinkTarget {
  return VALID_SYMLINK_TARGETS.includes(value as SymlinkTarget);
}

export function isValidAgentId(value: string): value is AgentId {
  return VALID_AGENT_IDS.includes(value as AgentId);
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

    if (typeof mem.source === 'string' && isValidMemorySource(mem.source)) {
      config.memory.source = mem.source;
    }

    if (Array.isArray(mem.symlinks)) {
      const validSymlinks = mem.symlinks.filter(
        (s): s is SymlinkTarget => typeof s === 'string' && isValidSymlinkTarget(s)
      );
      config.memory.symlinks = validSymlinks;
    }

    if (typeof mem.symlinking === 'boolean') {
      config.memory.symlinking = mem.symlinking;
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
      source: config.memory.source,
      symlinks: config.memory.symlinks,
      symlinking: config.memory.symlinking,
    },
    agents: config.agents,
    files: {
      ralph: config.files.ralph,
      todo: config.files.todo,
    },
  });

  // Add comments for documentation
  const memoryNode = doc.get('memory', true) as YAML.YAMLMap;
  if (memoryNode) {
    const sourceNode = memoryNode.get('source', true);
    if (sourceNode && typeof sourceNode === 'object' && 'comment' in sourceNode) {
      (sourceNode as YAML.Scalar).comment = ' AGENTS.md | CLAUDE.md | GEMINI.md';
    }
    const symlinksNode = memoryNode.get('symlinks', true);
    if (symlinksNode && typeof symlinksNode === 'object' && 'comment' in symlinksNode) {
      (symlinksNode as YAML.Scalar).comment = ' targets to symlink to source';
    }
    const symlinkingNode = memoryNode.get('symlinking', true);
    if (symlinkingNode && typeof symlinkingNode === 'object' && 'comment' in symlinkingNode) {
      (symlinkingNode as YAML.Scalar).comment = ' enable/disable symlink creation';
    }
  }

  return doc.toString();
}

export function getSymlinkTargetsForSource(config: SwarmifyConfig): SymlinkTarget[] {
  // Return symlinks that are different from the source
  return config.memory.symlinks.filter(target => target !== config.memory.source);
}

export function getSourceFileName(config: SwarmifyConfig): MemorySource {
  return config.memory.source;
}
