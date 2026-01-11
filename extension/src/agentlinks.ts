// Pure functions for memory file symlink suggestions (no VS Code dependencies)

import { SwarmifyConfig, MemoryFileMapping, getDefaultConfig } from './swarmifyConfig';

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

// Check if a filename is a pattern (source) in the config
export function isMemorySourceFile(fileName: string, config: SwarmifyConfig): boolean {
  return config.memory.files.some(f => f.pattern === fileName);
}

// Get all file mappings from config
export function getFileMappings(config: SwarmifyConfig): MemoryFileMapping[] {
  return config.memory.files;
}

// Get all patterns (source files) from config
export function getPatternFiles(config: SwarmifyConfig): string[] {
  return config.memory.files.map(f => f.pattern);
}

// Get symlinks for a specific pattern
export function getSymlinksForPattern(config: SwarmifyConfig, pattern: string): string[] {
  const mapping = config.memory.files.find(f => f.pattern === pattern);
  return mapping ? mapping.symlinks : [];
}

export function isSymlinkingEnabled(config: SwarmifyConfig): boolean {
  return config.memory.symlinking;
}

export { getDefaultConfig };
