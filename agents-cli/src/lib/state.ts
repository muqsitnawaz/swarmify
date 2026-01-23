import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { State } from './types.js';

const HOME = os.homedir();
const AGENTS_DIR = path.join(HOME, '.agents');
const STATE_FILE = path.join(AGENTS_DIR, 'state.json');
const PACKAGES_DIR = path.join(AGENTS_DIR, 'packages');
const REPOS_DIR = path.join(AGENTS_DIR, 'repos');

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

export function createDefaultState(): State {
  return {
    version: '1.0',
    lastSync: null,
    source: null,
    clis: {},
    packages: {},
    commands: {},
    mcp: {},
  };
}

export function readState(): State {
  ensureAgentsDir();
  if (!fs.existsSync(STATE_FILE)) {
    return createDefaultState();
  }
  try {
    const content = fs.readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(content) as State;
  } catch {
    return createDefaultState();
  }
}

export function writeState(state: State): void {
  ensureAgentsDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

export function updateState(updates: Partial<State>): State {
  const state = readState();
  const newState = { ...state, ...updates };
  writeState(newState);
  return newState;
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
