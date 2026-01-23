import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import type { Meta, State, ScopeConfig, ScopeName } from './types.js';
import { SCOPE_PRIORITIES, DEFAULT_SYSTEM_REPO } from './types.js';

const HOME = os.homedir();
const AGENTS_DIR = path.join(HOME, '.agents');
const META_FILE = path.join(AGENTS_DIR, 'meta.yaml');
const PACKAGES_DIR = path.join(AGENTS_DIR, 'packages');
const REPOS_DIR = path.join(AGENTS_DIR, 'repos');

const META_HEADER = `# agents-cli metadata
# Auto-generated - do not edit manually
# https://github.com/muqsitnawaz/agents-cli

`;

export function getAgentsDir(): string {
  return AGENTS_DIR;
}

export function getPackagesDir(): string {
  return PACKAGES_DIR;
}

export function getReposDir(): string {
  return REPOS_DIR;
}

export function ensureAgentsDir(): void {
  if (!fs.existsSync(AGENTS_DIR)) {
    fs.mkdirSync(AGENTS_DIR, { recursive: true });
  }
  if (!fs.existsSync(PACKAGES_DIR)) {
    fs.mkdirSync(PACKAGES_DIR, { recursive: true });
  }
  if (!fs.existsSync(REPOS_DIR)) {
    fs.mkdirSync(REPOS_DIR, { recursive: true });
  }
}

export function createDefaultMeta(): Meta {
  return {
    version: '1.0',
    scopes: {},
    clis: {},
    packages: {},
    commands: {},
    skills: {},
    mcp: {},
  };
}

export function readMeta(): Meta {
  ensureAgentsDir();

  // Migration: check for old state.json
  const oldStateFile = path.join(AGENTS_DIR, 'state.json');
  if (fs.existsSync(oldStateFile) && !fs.existsSync(META_FILE)) {
    try {
      const oldContent = fs.readFileSync(oldStateFile, 'utf-8');
      const oldState = JSON.parse(oldContent);

      // Migrate old repo format to scopes
      const scopes: Record<ScopeName, ScopeConfig> = {};
      if (oldState.source) {
        // Old single repo becomes user scope
        scopes.user = {
          source: oldState.source,
          branch: 'main',
          commit: 'unknown',
          lastSync: oldState.lastSync || new Date().toISOString(),
          priority: SCOPE_PRIORITIES.user,
        };
      }

      const meta: Meta = {
        version: '1.0',
        scopes,
        clis: oldState.clis || {},
        packages: oldState.packages || {},
        commands: oldState.commands || {},
        skills: oldState.skills || {},
        mcp: oldState.mcp || {},
      };
      writeMeta(meta);
      fs.unlinkSync(oldStateFile);
      return meta;
    } catch {
      // Ignore migration errors
    }
  }

  // Migration: check for old meta.yaml with repo field
  if (fs.existsSync(META_FILE)) {
    try {
      const content = fs.readFileSync(META_FILE, 'utf-8');
      const parsed = yaml.parse(content) as any;

      // Migrate old repo field to scopes
      if (parsed.repo && !parsed.scopes) {
        const scopes: Record<ScopeName, ScopeConfig> = {};
        scopes.user = {
          source: parsed.repo.source,
          branch: parsed.repo.branch || 'main',
          commit: parsed.repo.commit || 'unknown',
          lastSync: parsed.repo.lastSync || new Date().toISOString(),
          priority: SCOPE_PRIORITIES.user,
        };

        const meta: Meta = {
          version: parsed.version || '1.0',
          scopes,
          clis: parsed.clis || {},
          packages: parsed.packages || {},
          commands: parsed.commands || {},
          skills: parsed.skills || {},
          mcp: parsed.mcp || {},
        };
        writeMeta(meta);
        return meta;
      }

      return parsed as Meta;
    } catch {
      return createDefaultMeta();
    }
  }

  return createDefaultMeta();
}

export function writeMeta(meta: Meta): void {
  ensureAgentsDir();
  const content = META_HEADER + yaml.stringify(meta);
  fs.writeFileSync(META_FILE, content, 'utf-8');
}

export function updateMeta(updates: Partial<Meta>): Meta {
  const meta = readMeta();
  const newMeta = { ...meta, ...updates };
  writeMeta(newMeta);
  return newMeta;
}

export function getRepoLocalPath(source: string): string {
  const sanitized = source
    .replace(/^gh:/, '')
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\//g, '-');
  return path.join(REPOS_DIR, sanitized);
}

export function getPackageLocalPath(source: string): string {
  const sanitized = source
    .replace(/^gh:/, '')
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\//g, '-');
  return path.join(PACKAGES_DIR, sanitized);
}

// Scope management helpers

export function getScope(scopeName: ScopeName): ScopeConfig | null {
  const meta = readMeta();
  return meta.scopes[scopeName] || null;
}

export function setScope(scopeName: ScopeName, config: ScopeConfig): void {
  const meta = readMeta();
  meta.scopes[scopeName] = config;
  writeMeta(meta);
}

export function removeScope(scopeName: ScopeName): boolean {
  const meta = readMeta();
  if (meta.scopes[scopeName]) {
    delete meta.scopes[scopeName];
    writeMeta(meta);
    return true;
  }
  return false;
}

export function getScopesByPriority(): Array<{ name: ScopeName; config: ScopeConfig }> {
  const meta = readMeta();
  return Object.entries(meta.scopes)
    .map(([name, config]) => ({ name, config }))
    .sort((a, b) => a.config.priority - b.config.priority);
}

export function getHighestPriorityScope(): { name: ScopeName; config: ScopeConfig } | null {
  const scopes = getScopesByPriority();
  return scopes.length > 0 ? scopes[scopes.length - 1] : null;
}

export function getScopePriority(scopeName: ScopeName): number {
  if (scopeName in SCOPE_PRIORITIES) {
    return SCOPE_PRIORITIES[scopeName as keyof typeof SCOPE_PRIORITIES];
  }
  // Custom scopes get priority 20 + order added
  const meta = readMeta();
  const customScopes = Object.keys(meta.scopes).filter(
    (s) => !['system', 'user', 'project'].includes(s)
  );
  const index = customScopes.indexOf(scopeName);
  return index >= 0 ? 20 + index : 25;
}

// Legacy aliases
export const readState = readMeta;
export const writeState = (state: State) => writeMeta(state);
export const updateState = (updates: Partial<State>) => updateMeta(updates);
export const createDefaultState = createDefaultMeta;
