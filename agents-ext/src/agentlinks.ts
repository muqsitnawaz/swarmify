// Pure functions for AGENTS.md symlink suggestions (no VS Code dependencies)

export const AGENTS_FILENAME = 'AGENTS.md';
export const AGENT_SYMLINK_TARGETS = ['CLAUDE.md', 'GEMINI.md'] as const;

export type AgentSymlinkTarget = (typeof AGENT_SYMLINK_TARGETS)[number];

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
