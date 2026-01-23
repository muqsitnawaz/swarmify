export type AgentId = 'claude' | 'codex' | 'gemini' | 'cursor' | 'opencode' | 'trae';

export interface AgentConfig {
  id: AgentId;
  name: string;
  cliCommand: string;
  npmPackage: string;
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
  command: string;
  transport: 'stdio' | 'sse';
  scope: 'user' | 'project';
  agents: AgentId[];
  env?: Record<string, string>;
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
