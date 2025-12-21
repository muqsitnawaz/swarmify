import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { AgentType } from './parsers.js';

// All supported swarm agent types
const ALL_AGENTS: AgentType[] = ['cursor', 'codex', 'claude', 'gemini'];

// Base directory for all swarm data
const SWARM_DIR = path.join(homedir(), '.agent-swarm');
const AGENTS_DIR = path.join(SWARM_DIR, 'agents');
const CONFIG_PATH = path.join(SWARM_DIR, 'config.json');

// Config file structure
interface SwarmConfig {
  enabledAgents: AgentType[];
}

export async function resolveAgentsDir(): Promise<string> {
  await fs.mkdir(AGENTS_DIR, { recursive: true });
  return AGENTS_DIR;
}

// Read swarm config, returns all agents enabled if config doesn't exist
export async function readConfig(): Promise<SwarmConfig> {
  try {
    const data = await fs.readFile(CONFIG_PATH, 'utf-8');
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
  await fs.mkdir(SWARM_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}
