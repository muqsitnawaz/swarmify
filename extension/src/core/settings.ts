// Settings types and pure functions (no VS Code dependencies - testable)

// Per-agent configuration for built-in agents
export interface BuiltInAgentConfig {
  login: boolean;
  instances: number;
  defaultModel?: string;
}

// Custom agent configuration
export interface CustomAgentConfig {
  name: string;
  command: string;
  login: boolean;
  instances: number;
}

// Command alias for built-in agents with custom flags
// e.g., "Fast" alias for Claude with "--model claude-haiku-4-5-20251001"
export interface CommandAlias {
  name: string;           // Display name (e.g., "Fast", "Max Context")
  agent: string;          // Built-in agent key: "claude" | "codex" | "gemini" | etc.
  flags: string;          // Additional CLI flags (e.g., "--model claude-haiku-4-5-20251001")
}

// Prompt entry for saving reusable prompts
export interface PromptEntry {
  id: string;
  title: string;
  content: string;
  isFavorite: boolean;
  createdAt: number;
  updatedAt: number;
  accessedAt: number;  // Last time prompt was used (for sorting by recency)
}

// Swarm agent types (subset of built-in agents that support swarm)
export type SwarmAgentType = 'claude' | 'codex' | 'gemini';
export const ALL_SWARM_AGENTS: SwarmAgentType[] = ['claude', 'codex', 'gemini'];

// Full agent settings structure
export interface AgentSettings {
  builtIn: {
    claude: BuiltInAgentConfig;
    codex: BuiltInAgentConfig;
    gemini: BuiltInAgentConfig;
    opencode: BuiltInAgentConfig;
    cursor: BuiltInAgentConfig;
    shell: BuiltInAgentConfig;
  };
  custom: CustomAgentConfig[];
  aliases: CommandAlias[];
  swarmEnabledAgents: SwarmAgentType[];
  prompts: PromptEntry[];
  editor: EditorPreferences;
  display: DisplayPreferences;
  notifications?: NotificationSettings;
  showWelcomeScreen: boolean;       // Open dashboard on VS Code startup
  taskSources: TaskSourceSettings;  // Task sources for Tasks tab
}

export interface EditorPreferences {
  markdownViewerEnabled: boolean;
}

// Display preferences for terminal titles and labels
export interface DisplayPreferences {
  showFullAgentNames: boolean;
  showLabelsInTitles: boolean;
  showSessionIdInTitles: boolean;
  labelReplacesTitle: boolean;  // true = label replaces title, false = append with dash
  showLabelOnlyOnFocus: boolean;  // true = hide label when terminal loses focus
}

export interface NotificationSettings {
  enabled: boolean;
  style: 'native' | 'vscode';
  enabledAgents: string[];
}

// Task source settings for multi-source Tasks tab
export type TaskSource = 'markdown' | 'linear' | 'github';

export interface TaskSourceSettings {
  markdown: boolean;  // default: true (always available)
  linear: boolean;    // default: false (auto-enable if Linear MCP detected)
  github: boolean;    // default: false (auto-enable if GitHub MCP detected)
}

export const DEFAULT_TASK_SOURCE_SETTINGS: TaskSourceSettings = {
  markdown: true,
  linear: false,
  github: false
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: false,
  style: 'native',
  enabledAgents: ['claude']
};

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  showFullAgentNames: true,
  showLabelsInTitles: true,
  showSessionIdInTitles: true,
  labelReplacesTitle: false,  // Default: append label (e.g., "Claude - label")
  showLabelOnlyOnFocus: false  // Default: always show label
};

export const AGENT_MODELS: Record<string, string[]> = {
  claude: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5'],
  codex: ['gpt-5.2-codex', 'gpt-5.1-codex-max'],
  gemini: ['gemini-3-flash', 'gemini-3-pro'],
  cursor: ['composer-1'],
  opencode: [],
  shell: []
};

// Default settings (pure function)
export function getDefaultSettings(): AgentSettings {
  return {
    builtIn: {
      claude: { login: false, instances: 2 },
      codex: { login: false, instances: 2 },
      gemini: { login: false, instances: 2 },
      opencode: { login: false, instances: 2 },
      cursor: { login: false, instances: 2 },
      shell: { login: false, instances: 1 }
    },
    custom: [],
    aliases: [],
    swarmEnabledAgents: [...ALL_SWARM_AGENTS],
    prompts: [],
    editor: { markdownViewerEnabled: true },
    display: { ...DEFAULT_DISPLAY_PREFERENCES },
    notifications: { ...DEFAULT_NOTIFICATION_SETTINGS },
    showWelcomeScreen: true,
    taskSources: { ...DEFAULT_TASK_SOURCE_SETTINGS }
  };
}

// Check if any agents have login enabled (pure function)
export function hasLoginEnabled(settings: AgentSettings): boolean {
  return (
    Object.values(settings.builtIn).some(a => a.login) ||
    settings.custom.some(a => a.login)
  );
}
