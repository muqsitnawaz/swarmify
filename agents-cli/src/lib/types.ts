export type AgentId = 'claude' | 'codex' | 'gemini' | 'cursor' | 'opencode';

export interface AgentConfig {
  id: AgentId;
  name: string;
  cliCommand: string;
  npmPackage: string;
  installScript?: string;
  configDir: string;
  commandsDir: string;
  commandsSubdir: string;
  skillsDir: string;
  hooksDir: string;
  format: 'markdown' | 'toml';
  variableSyntax: string;
  supportsHooks: boolean;
  capabilities: {
    hooks: boolean;
    mcp: boolean;
    allowlist: boolean;
    skills: boolean;
  };
}

export interface CliConfig {
  package: string;
  version: string;
}

export interface McpServerConfig {
  command?: string;
  url?: string;
  transport: 'stdio' | 'http' | 'sse';
  scope: 'user' | 'project';
  agents: AgentId[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface HookConfig {
  name: string;
  script: string;
  dataFile?: string;
}

export interface InstalledHook {
  name: string;
  path: string;
  dataFile?: string;
  scope: 'user' | 'project';
  agent: AgentId;
}

export interface Manifest {
  clis?: Partial<Record<AgentId, CliConfig>>;
  dependencies?: Record<string, string>;
  mcp?: Record<string, McpServerConfig>;
  defaults?: {
    method?: 'symlink' | 'copy';
    scope?: 'global' | 'project';
    agents?: AgentId[];
  };
}

export interface CliState {
  installed: boolean;
  version: string | null;
  path: string | null;
}

export interface CommandInstallation {
  path: string;
  method: 'symlink' | 'copy';
}

export interface CommandState {
  source: string;
  installations: Partial<Record<AgentId, CommandInstallation>>;
}

export interface McpState {
  registeredWith: AgentId[];
  version?: string;
}

export interface SkillMetadata {
  name: string;
  description: string;
  author?: string;
  version?: string;
  license?: string;
  keywords?: string[];
}

export interface SkillInstallation {
  path: string;
  method: 'symlink' | 'copy';
}

export interface SkillState {
  source: string;
  ruleCount: number;
  installations: Partial<Record<AgentId, SkillInstallation>>;
}

export interface InstalledSkill {
  name: string;
  path: string;
  metadata: SkillMetadata;
  ruleCount: number;
  scope: 'user' | 'project';
  agent: AgentId;
}

export interface PackageState {
  localPath: string;
  commit: string;
  installedAt: string;
}

export interface RepoInfo {
  source: string;
  branch: string;
  commit: string;
  lastSync: string;
}

// Built-in scopes have fixed priorities
// system: 0, user: 10, custom: 20+, project: 100 (always highest)
export type BuiltinScope = 'system' | 'user' | 'project';
export type ScopeName = BuiltinScope | string;

export const SCOPE_PRIORITIES: Record<BuiltinScope, number> = {
  system: 0,
  user: 10,
  project: 100,
};

export const DEFAULT_SYSTEM_REPO = 'gh:muqsitnawaz/.agents';

// Registry types
export type RegistryType = 'mcp' | 'skill';

export interface RegistryConfig {
  url: string;
  enabled: boolean;
  apiKey?: string;
}

export const DEFAULT_REGISTRIES: Record<RegistryType, Record<string, RegistryConfig>> = {
  mcp: {
    official: {
      url: 'https://registry.modelcontextprotocol.io/v0',
      enabled: true,
    },
  },
  skill: {
    // No public API available yet - skills.sh has no programmatic access
    // When available: official: { url: 'https://api.skills.sh/v1', enabled: true }
  },
};

// MCP Registry API response types
export interface McpPackage {
  registry_name: string;
  name: string;
  description?: string;
  runtime?: 'node' | 'python' | 'docker' | 'binary';
  transport?: 'stdio' | 'sse' | 'streamable-http';
  packageArguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface McpServerEntry {
  name: string;
  description?: string;
  repository?: {
    url: string;
    source?: string;
    directory?: string;
  };
  version_detail?: {
    version: string;
  };
  packages?: McpPackage[];
  _meta?: Record<string, unknown>;
}

export interface McpRegistryResponse {
  servers: Array<{ server: McpServerEntry }>;
  metadata?: {
    count: number;
    next_cursor?: string;
  };
}

// Skill Registry API response types (for future use)
export interface SkillEntry {
  name: string;
  description?: string;
  source: string;
  path?: string;
  author?: string;
  installs?: number;
  tags?: string[];
}

export interface SkillRegistryResponse {
  skills: SkillEntry[];
  metadata?: {
    count: number;
    next_cursor?: string;
  };
}

// Unified search result
export interface RegistrySearchResult {
  name: string;
  description?: string;
  type: 'mcp' | 'skill';
  source: string;
  registry: string;
  version?: string;
  installs?: number;
}

// Resolved package for installation
export interface ResolvedPackage {
  type: 'mcp' | 'skill' | 'git';
  source: string;
  mcpEntry?: McpServerEntry;
  skillEntry?: SkillEntry;
}

export interface ScopeConfig {
  source: string;
  branch: string;
  commit: string;
  lastSync: string;
  priority: number;
  readonly?: boolean;
}

export interface Meta {
  version: string;
  scopes: Record<ScopeName, ScopeConfig>;
  registries?: Record<RegistryType, Record<string, RegistryConfig>>;
  clis: Partial<Record<AgentId, CliState>>;
  packages: Record<string, PackageState>;
  commands: Record<string, CommandState>;
  skills: Record<string, SkillState>;
  mcp: Record<string, McpState>;
}

// Legacy alias
export type State = Meta;

export interface SyncOptions {
  agents?: AgentId[];
  yes?: boolean;
  force?: boolean;
  dryRun?: boolean;
  skipClis?: boolean;
  skipMcp?: boolean;
}
