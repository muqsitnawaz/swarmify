export type AgentId = 'claude' | 'codex' | 'gemini' | 'cursor' | 'opencode' | 'trae';

export interface AgentConfig {
  id: AgentId;
  name: string;
  cliCommand: string;
  npmPackage: string;
  configDir: string;
  commandsDir: string;
  commandsSubdir: string;
  hooksDir: string;
  format: 'markdown' | 'toml';
  variableSyntax: string;
  supportsHooks: boolean;
  capabilities: {
    hooks: boolean;
    mcp: boolean;
    allowlist: boolean;
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

export interface Meta {
  version: string;
  repo: RepoInfo | null;
  clis: Partial<Record<AgentId, CliState>>;
  packages: Record<string, PackageState>;
  commands: Record<string, CommandState>;
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
