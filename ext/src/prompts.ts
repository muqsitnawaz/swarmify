// Pure prompts I/O functions (no VS Code dependencies - testable)

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { PromptEntry } from './settings';

// Built-in default prompts
export const DEFAULT_PROMPTS: PromptEntry[] = [
  {
    id: 'builtin-rethink',
    title: 'rethink',
    content: 'But before we go ahead and make this change, what do you think? Is this the right direction for our product? Reread any relevant files and recall our philosophy and see if making this choice brings us closer to our goal.',
    isFavorite: true,
    createdAt: 0,
    updatedAt: 0,
    accessedAt: 0
  },
  {
    id: 'builtin-debugit',
    title: 'debugit',
    content: 'Confirm the root cause of these issues by spinning up codex and gemini agents via swarm. You should clearly explain the context of the issues, the app and what the user is observing. Explain why that is problematic from a user experience standpoint. And then ask them to clearly figure out the root cause and explain how fixing that would fix those issues. Do not tell them your solution since we don\'t want to bias their thinking. We want to see if they will independently arrive at the same conclusion or not.',
    isFavorite: true,
    createdAt: 0,
    updatedAt: 0,
    accessedAt: 0
  }
];

/**
 * Read prompts from a YAML file.
 * Returns default prompts if file doesn't exist, is empty, or is corrupted.
 * Automatically migrates old prompts missing accessedAt field.
 */
export function readPromptsFromPath(filePath: string): { prompts: PromptEntry[]; usedDefaults: boolean } {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      const parsed = YAML.parse(data);

      if (Array.isArray(parsed) && parsed.length > 0) {
        // Migrate: add accessedAt if missing
        const prompts = parsed.map(p => ({
          ...p,
          accessedAt: p.accessedAt ?? 0
        }));
        return { prompts, usedDefaults: false };
      }
    }
  } catch (err) {
    // File corrupted or invalid YAML - fall through to defaults
    console.error('Failed to read prompts:', err);
  }

  return { prompts: [...DEFAULT_PROMPTS], usedDefaults: true };
}

/**
 * Write prompts to a YAML file.
 * Creates parent directories if they don't exist.
 * Returns true on success, false on failure.
 */
export function writePromptsToPath(filePath: string, prompts: PromptEntry[]): boolean {
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, YAML.stringify(prompts));
    return true;
  } catch (err) {
    console.error('Failed to write prompts:', err);
    return false;
  }
}

/**
 * Validate a prompt entry has all required fields.
 */
export function isValidPromptEntry(entry: unknown): entry is PromptEntry {
  if (typeof entry !== 'object' || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.title === 'string' &&
    typeof e.content === 'string' &&
    typeof e.isFavorite === 'boolean' &&
    typeof e.createdAt === 'number' &&
    typeof e.updatedAt === 'number' &&
    typeof e.accessedAt === 'number'
  );
}
