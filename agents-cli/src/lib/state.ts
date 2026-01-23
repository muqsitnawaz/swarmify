import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import type { Meta, State } from './types.js';

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
    repo: null,
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
      const meta: Meta = {
        version: oldState.version || '1.0',
        repo: oldState.source
          ? {
              source: oldState.source,
              branch: 'main',
              commit: 'unknown',
              lastSync: oldState.lastSync || new Date().toISOString(),
            }
          : null,
        clis: oldState.clis || {},
        packages: oldState.packages || {},
        commands: oldState.commands || oldState.skills || {},
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

  if (!fs.existsSync(META_FILE)) {
    return createDefaultMeta();
  }

  try {
    const content = fs.readFileSync(META_FILE, 'utf-8');
    return yaml.parse(content) as Meta;
  } catch {
    return createDefaultMeta();
  }
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

// Legacy aliases
export const readState = readMeta;
export const writeState = (state: State) => writeMeta(state);
export const updateState = (updates: Partial<State>) => updateMeta(updates);
export const createDefaultState = createDefaultMeta;
