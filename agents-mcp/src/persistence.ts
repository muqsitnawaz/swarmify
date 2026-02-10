import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir, tmpdir } from 'os';
import { constants as fsConstants } from 'fs';
import { AgentType } from './parsers.js';

// All supported swarm agent types
const ALL_AGENTS: AgentType[] = ['claude', 'codex', 'gemini', 'cursor', 'opencode'];

// Swarm data lives under ~/.agents/swarm/
const SWARM_DIR = path.join(homedir(), '.agents', 'swarm');

// Legacy paths (for migration)
const LEGACY_CONFIG_DIR = path.join(homedir(), '.agents');
const LEGACY_BASE_DIR = path.join(homedir(), '.swarmify');
const TMP_FALLBACK_DIR = path.join(tmpdir(), 'agents');

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
  if (await ensureWritableDir(SWARM_DIR)) {
    return SWARM_DIR;
  }

  if (await ensureWritableDir(TMP_FALLBACK_DIR)) {
    console.warn(`[agents-mcp] Falling back to temp data dir at ${TMP_FALLBACK_DIR}`);
    return TMP_FALLBACK_DIR;
  }

  throw new Error('Unable to determine writable data directory for swarm');
}

async function resolveAgentsPath(): Promise<string> {
  const base = await resolveBaseDir();
  return path.join(base, 'agents');
}

async function resolveConfigPath(): Promise<string> {
  await fs.mkdir(SWARM_DIR, { recursive: true });
  return path.join(SWARM_DIR, 'config.json');
}

async function resolveLegacyConfigPath(): Promise<string> {
  return path.join(LEGACY_CONFIG_DIR, 'config.json');
}

async function resolveLegacySwarmifyConfigPath(): Promise<string> {
  return path.join(LEGACY_BASE_DIR, 'agents', 'config.json');
}

export type EffortLevel = 'fast' | 'default' | 'detailed';

export type ModelOverrides = Partial<Record<AgentType, Partial<Record<EffortLevel, string>>>>;

export interface ProviderConfig {
  apiEndpoint: string | null;
}

export interface AgentModelConfig {
  fast: string;
  default: string;
  detailed: string;
}

export interface AgentConfig {
  command: string;
  enabled: boolean;
  models: AgentModelConfig;
  provider: string;
}

export interface SwarmConfig {
  agents: Record<AgentType, AgentConfig>;
  providers: Record<string, ProviderConfig>;
}

export interface ReadConfigResult {
  hasConfig: boolean;
  enabledAgents: AgentType[];
  agentConfigs: Record<AgentType, AgentConfig>;
  providerConfigs: Record<string, ProviderConfig>;
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

// Get default agent configuration
function getDefaultAgentConfig(agentType: AgentType): AgentConfig {
  const defaults: Record<AgentType, AgentConfig> = {
    claude: {
      command: 'claude -p \'{prompt}\' --output-format stream-json --json',
      enabled: true,
      models: {
        fast: 'claude-haiku-4-5-20251001',
        default: 'claude-sonnet-4-5',
        detailed: 'claude-opus-4-5'
      },
      provider: 'anthropic'
    },
    codex: {
      command: 'codex exec --sandbox workspace-write \'{prompt}\' --json',
      enabled: true,
      models: {
        fast: 'gpt-4o-mini',
        default: 'gpt-5.2-codex',
        detailed: 'gpt-5.1-codex-max'
      },
      provider: 'openai'
    },
    gemini: {
      command: 'gemini \'{prompt}\' --output-format stream-json',
      enabled: true,
      models: {
        fast: 'gemini-3-flash-preview',
        default: 'gemini-3-flash-preview',
        detailed: 'gemini-3-pro-preview'
      },
      provider: 'google'
    },
    cursor: {
      command: 'cursor-agent -p --output-format stream-json \'{prompt}\'',
      enabled: true,
      models: {
        fast: 'composer-1',
        default: 'composer-1',
        detailed: 'composer-1'
      },
      provider: 'custom'
    },
    opencode: {
      command: 'opencode run --format json \'{prompt}\'',
      enabled: true,
      models: {
        fast: 'zai-coding-plan/glm-4.7-flash',
        default: 'zai-coding-plan/glm-4.7',
        detailed: 'zai-coding-plan/glm-4.7'
      },
      provider: 'custom'
    }
  };

  return defaults[agentType];
}

// Get default provider configuration
function getDefaultProviderConfig(): Record<string, ProviderConfig> {
  return {
    anthropic: {
      apiEndpoint: 'https://api.anthropic.com'
    },
    openai: {
      apiEndpoint: 'https://api.openai.com/v1'
    },
    google: {
      apiEndpoint: 'https://generativelanguage.googleapis.com/v1'
    },
    custom: {
      apiEndpoint: null
    }
  };
}

// Get default full configuration
function getDefaultSwarmConfig(): SwarmConfig {
  const agents: Record<string, AgentConfig> = {};
  for (const agentType of ALL_AGENTS) {
    agents[agentType] = getDefaultAgentConfig(agentType);
  }

  return {
    agents,
    providers: getDefaultProviderConfig()
  };
}

// Try to read a config file as either SwarmConfig or legacy format
async function tryReadLegacyConfig(configPath: string): Promise<SwarmConfig | null> {
  try {
    const data = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(data);

    // New format: has agents object with nested configs
    if (parsed.agents && typeof parsed.agents === 'object') {
      const firstValue = Object.values(parsed.agents)[0];
      if (firstValue && typeof firstValue === 'object' && 'models' in (firstValue as object)) {
        return parsed as SwarmConfig;
      }
    }

    // Old format: { enabledAgents: string[] }
    if (parsed.enabledAgents && Array.isArray(parsed.enabledAgents)) {
      const defaultConfig = getDefaultSwarmConfig();
      for (const agentType of parsed.enabledAgents) {
        if (ALL_AGENTS.includes(agentType as AgentType)) {
          defaultConfig.agents[agentType as AgentType].enabled = true;
        }
      }
      return defaultConfig;
    }

    return null;
  } catch {
    return null;
  }
}

// Migrate from legacy config locations
async function migrateLegacyConfig(): Promise<SwarmConfig | null> {
  // Try ~/.agents/config.json first (most recent legacy location)
  const legacyConfigPath = await resolveLegacyConfigPath();
  let config = await tryReadLegacyConfig(legacyConfigPath);

  // Try ~/.swarmify/agents/config.json
  if (!config) {
    const swarmifyConfigPath = await resolveLegacySwarmifyConfigPath();
    config = await tryReadLegacyConfig(swarmifyConfigPath);
  }

  if (!config) return null;

  // Write migrated config to new location
  const newConfigPath = await ensureConfigPath();
  await fs.writeFile(newConfigPath, JSON.stringify(config, null, 2));
  console.warn(`[agents-mcp] Migrated config to ${newConfigPath}`);

  return config;
}

// Read swarm config, returns default config if file doesn't exist
export async function readConfig(): Promise<ReadConfigResult> {
  const configPath = await ensureConfigPath();

  // Try to read new config first
  try {
    const data = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(data) as SwarmConfig;

    const enabledAgents: AgentType[] = [];
    const agentConfigs: Record<AgentType, AgentConfig> = {} as Record<AgentType, AgentConfig>;
    const providerConfigs: Record<string, ProviderConfig> = {};

    // Parse agent configs
    if (config.agents && typeof config.agents === 'object') {
      for (const [agentKey, agentValue] of Object.entries(config.agents)) {
        if (!ALL_AGENTS.includes(agentKey as AgentType)) continue;
        const agentType = agentKey as AgentType;

        // Merge with defaults for missing fields
        const defaultAgentConfig = getDefaultAgentConfig(agentType);
        const mergedAgentConfig = {
          ...defaultAgentConfig,
          ...(agentValue as Partial<AgentConfig>)
        };

        if (mergedAgentConfig.enabled) {
          enabledAgents.push(agentType);
        }
        agentConfigs[agentType] = mergedAgentConfig;
      }
    }

    // Fill in missing agents with defaults
    for (const agentType of ALL_AGENTS) {
      if (!agentConfigs[agentType]) {
        agentConfigs[agentType] = getDefaultAgentConfig(agentType);
      }
    }

    // Parse provider configs
    if (config.providers && typeof config.providers === 'object') {
      for (const [providerKey, providerValue] of Object.entries(config.providers)) {
        const providerConfig = providerValue as ProviderConfig;
        providerConfigs[providerKey] = providerConfig;
      }
    }

    // Fill in missing providers with defaults
    const defaultProviders = getDefaultProviderConfig();
    for (const [providerKey, providerValue] of Object.entries(defaultProviders)) {
      if (!providerConfigs[providerKey]) {
        providerConfigs[providerKey] = providerValue;
      }
    }

    return { enabledAgents, agentConfigs, providerConfigs, hasConfig: true };
  } catch {
    // Config doesn't exist or is invalid, try migration
    const migratedConfig = await migrateLegacyConfig();
    if (migratedConfig) {
      const enabledAgents: AgentType[] = [];
      const agentConfigs: Record<AgentType, AgentConfig> = {} as Record<AgentType, AgentConfig>;
      const providerConfigs = migratedConfig.providers;

      for (const [agentKey, agentValue] of Object.entries(migratedConfig.agents)) {
        const agentType = agentKey as AgentType;
        agentConfigs[agentType] = agentValue;
        if (agentValue.enabled) {
          enabledAgents.push(agentType);
        }
      }

      return { enabledAgents, agentConfigs, providerConfigs, hasConfig: true };
    }

    // No config and no legacy config, return defaults
    const defaultConfig = getDefaultSwarmConfig();
    const enabledAgents: AgentType[] = [];
    const agentConfigs: Record<AgentType, AgentConfig> = defaultConfig.agents as Record<AgentType, AgentConfig>;
    const providerConfigs = defaultConfig.providers;

    for (const [agentKey, agentValue] of Object.entries(defaultConfig.agents)) {
      if (agentValue.enabled) {
        enabledAgents.push(agentKey as AgentType);
      }
    }

    // Write default config to file
    await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2));

    return { enabledAgents, agentConfigs, providerConfigs, hasConfig: false };
  }
}

// Write swarm config
export async function writeConfig(config: SwarmConfig): Promise<void> {
  const configPath = await ensureConfigPath();
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

// Get model for agent type and effort level
export function getModelForAgent(
  agentConfigs: Record<AgentType, AgentConfig>,
  agentType: AgentType,
  effort: EffortLevel
): string {
  const agentConfig = agentConfigs[agentType];
  if (!agentConfig) {
    throw new Error(`Agent config not found for: ${agentType}`);
  }
  return agentConfig.models[effort];
}

// Update agent enabled status
export async function setAgentEnabled(agentType: AgentType, enabled: boolean): Promise<void> {
  const { agentConfigs } = await readConfig();
  agentConfigs[agentType].enabled = enabled;

  const configPath = await ensureConfigPath();
  const config = await fs.readFile(configPath, 'utf-8');
  const parsed = JSON.parse(config) as SwarmConfig;

  if (!parsed.agents[agentType]) {
    parsed.agents[agentType] = getDefaultAgentConfig(agentType);
  }
  parsed.agents[agentType].enabled = enabled;

  await fs.writeFile(configPath, JSON.stringify(parsed, null, 2));
}
