import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir, tmpdir } from 'os';
import { constants as fsConstants } from 'fs';
import { AgentType } from './parsers.js';

// All supported swarm agent types
const ALL_AGENTS: AgentType[] = ['claude', 'codex', 'gemini'];

// Preferred and legacy data roots
const PRIMARY_BASE_DIR = path.join(homedir(), '.swarmify');
const LEGACY_BASE_DIR = path.join(homedir(), '.agent-swarm');
const TMP_FALLBACK_DIR = path.join(tmpdir(), 'swarmify');

let RESOLVED_BASE_DIR: string | null = null;

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureWritableDir(p: string): Promise<boolean> {
  try {
    await fs.mkdir(p, { recursive: true });
    await fs.access(p, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveBaseDir(): Promise<string> {
  if (RESOLVED_BASE_DIR) return RESOLVED_BASE_DIR;

  // Preferred location
  if (await ensureWritableDir(PRIMARY_BASE_DIR)) {
    RESOLVED_BASE_DIR = PRIMARY_BASE_DIR;
    return RESOLVED_BASE_DIR;
  }

  // Legacy support if the old dir already exists or is the only writable spot
  if ((await pathExists(LEGACY_BASE_DIR)) && await ensureWritableDir(LEGACY_BASE_DIR)) {
    RESOLVED_BASE_DIR = LEGACY_BASE_DIR;
    console.warn(`[swarmify] Using legacy data dir at ${LEGACY_BASE_DIR}`);
    return RESOLVED_BASE_DIR;
  }

  // Writable tmp fallback
  if (await ensureWritableDir(TMP_FALLBACK_DIR)) {
    RESOLVED_BASE_DIR = TMP_FALLBACK_DIR;
    console.warn(`[swarmify] Falling back to temp data dir at ${TMP_FALLBACK_DIR}`);
    return RESOLVED_BASE_DIR;
  }

  throw new Error('Unable to determine writable data directory for swarmify agents');
}

async function resolveAgentsPath(): Promise<string> {
  const base = await resolveBaseDir();
  return path.join(base, 'agents');
}

async function resolveConfigPath(): Promise<string> {
  const base = await resolveBaseDir();
  return path.join(base, 'config.json');
}

// Config file structure
interface SwarmConfig {
  enabledAgents: AgentType[];
}

let AGENTS_DIR: string | null = null;
let CONFIG_PATH: string | null = null;

export async function resolveAgentsDir(): Promise<string> {
  if (!AGENTS_DIR) {
    AGENTS_DIR = await resolveAgentsPath();
  }
  await fs.mkdir(AGENTS_DIR, { recursive: true });
  return AGENTS_DIR;
}

async function ensureConfigPath(): Promise<string> {
  if (!CONFIG_PATH) {
    CONFIG_PATH = await resolveConfigPath();
  }
  const dir = path.dirname(CONFIG_PATH);
  await fs.mkdir(dir, { recursive: true });
  return CONFIG_PATH;
}

// Read swarm config, returns all agents enabled if config doesn't exist
export async function readConfig(): Promise<SwarmConfig> {
  const configPath = await ensureConfigPath();
  try {
    const data = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(data) as SwarmConfig;
    // Validate that enabledAgents only contains valid agent types
    if (config.enabledAgents && Array.isArray(config.enabledAgents)) {
      config.enabledAgents = config.enabledAgents.filter(a => ALL_AGENTS.includes(a));
    } else {
      config.enabledAgents = [...ALL_AGENTS];
    }
    return config;
  } catch {
    // Config doesn't exist or is invalid, return default (all agents)
    return { enabledAgents: [...ALL_AGENTS] };
  }
}

// Write swarm config
export async function writeConfig(config: SwarmConfig): Promise<void> {
  const configPath = await ensureConfigPath();
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}
