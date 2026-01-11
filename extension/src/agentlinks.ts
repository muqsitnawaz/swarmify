// Pure functions for memory file symlink suggestions (no VS Code dependencies)

import { SwarmifyConfig, MemorySource, getDefaultConfig } from './swarmifyConfig';

// Legacy constants for backward compatibility
export const AGENTS_FILENAME = 'AGENTS.md';
export const AGENT_SYMLINK_TARGETS = ['CLAUDE.md', 'GEMINI.md'] as const;

export type AgentSymlinkTarget = (typeof AGENT_SYMLINK_TARGETS)[number];

// Legacy functions for backward compatibility
export function isAgentsFileName(fileName: string): boolean {
  return fileName === AGENTS_FILENAME;
}

export function getSymlinkTargetsForFileName(fileName: string): AgentSymlinkTarget[] {
  return isAgentsFileName(fileName) ? [...AGENT_SYMLINK_TARGETS] : [];
}

export function getMissingTargets(
  candidates: readonly string[],
  existing: readonly string[]
): string[] {
  const existingSet = new Set(existing);
  return candidates.filter(name => !existingSet.has(name));
}

// Config-driven functions
export function isMemorySourceFile(fileName: string, config: SwarmifyConfig): boolean {
  return fileName === config.memory.source;
}

export function getSymlinkTargetsForConfig(config: SwarmifyConfig): string[] {
  // Return symlinks that are different from the source
  return config.memory.symlinks.filter(target => target !== config.memory.source);
}

export function getSourceFileNameFromConfig(config: SwarmifyConfig): MemorySource {
  return config.memory.source;
}

export function isSymlinkingEnabled(config: SwarmifyConfig): boolean {
  return config.memory.symlinking;
}

// Valid memory source filenames
const VALID_MEMORY_SOURCES: MemorySource[] = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'];

export function isValidMemorySourceFileName(fileName: string): fileName is MemorySource {
  return VALID_MEMORY_SOURCES.includes(fileName as MemorySource);
}

export { getDefaultConfig };
