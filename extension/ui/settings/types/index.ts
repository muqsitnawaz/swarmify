// Agent settings types
export interface BuiltInAgentSettings {
  login: boolean
  instances: number
  defaultModel?: string
}

export interface CustomAgentSettings {
  name: string
  command: string
  login: boolean
  instances: number
}

export interface CommandAlias {
  name: string
  agent: string
  flags: string
}

// Quick launch slot for keyboard shortcuts (Cmd+Shift+1/2/3)
export interface QuickLaunchSlot {
  agent: string
  model?: string
  label?: string
}

export interface QuickLaunchConfig {
  slot1?: QuickLaunchSlot
  slot2?: QuickLaunchSlot
  slot3?: QuickLaunchSlot
}

export type SwarmAgentType = 'claude' | 'codex' | 'gemini' | 'trae'
export type PromptPackAgentType = 'claude' | 'codex' | 'gemini' | 'cursor' | 'trae'

// Skills types
export type SkillName =
  | 'plan'
  | 'splan'
  | 'debug'
  | 'sdebug'
  | 'sconfirm'
  | 'clean'
  | 'sclean'
  | 'test'
  | 'stest'
  | 'ship'
  | 'sship'
  | 'recap'
  | 'srecap'
  | 'simagine'

export interface SkillAgentStatus {
  installed: boolean
  cliAvailable: boolean
  builtIn: boolean
  supported: boolean
}

export interface SkillCommandStatus {
  name: SkillName
  description: string
  agents: Record<PromptPackAgentType, SkillAgentStatus>
}

export interface SkillsStatus {
  commands: SkillCommandStatus[]
}

// Prompt types
export interface PromptEntry {
  id: string
  title: string
  content: string
  isFavorite: boolean
  createdAt: number
  updatedAt: number
  accessedAt: number
}

// Task types
export type TaskSource = 'markdown' | 'linear' | 'github'

export interface TaskSourceSettings {
  markdown: boolean
  linear: boolean
  github: boolean
}

export interface TodoItem {
  title: string
  description?: string
  completed: boolean
  line: number
  planFile?: string
}

export interface TodoFile {
  path: string
  items: TodoItem[]
}

export interface UnifiedTask {
  id: string
  source: TaskSource
  title: string
  description?: string
  status: 'todo' | 'in_progress' | 'done'
  priority?: 'urgent' | 'high' | 'medium' | 'low'
  metadata: {
    file?: string
    line?: number
    identifier?: string
    url?: string
    labels?: string[]
    assignee?: string
    state?: string
  }
}

// Settings types
export interface EditorPreferences {
  markdownViewerEnabled: boolean
}

export interface DisplayPreferences {
  showFullAgentNames: boolean
  showLabelsInTitles: boolean
  showSessionIdInTitles: boolean
  labelReplacesTitle: boolean
  showLabelOnlyOnFocus: boolean
}

export interface NotificationSettings {
  enabled: boolean
  style: 'native' | 'vscode'
  enabledAgents: string[]
}

export interface AgentSettings {
  builtIn: {
    claude: BuiltInAgentSettings
    codex: BuiltInAgentSettings
    gemini: BuiltInAgentSettings
    opencode: BuiltInAgentSettings
    cursor: BuiltInAgentSettings
    trae: BuiltInAgentSettings
    shell: BuiltInAgentSettings
  }
  custom: CustomAgentSettings[]
  aliases: CommandAlias[]
  quickLaunch?: QuickLaunchConfig
  swarmEnabledAgents: SwarmAgentType[]
  prompts: PromptEntry[]
  editor: EditorPreferences
  display: DisplayPreferences
  notifications?: NotificationSettings
  showWelcomeScreen: boolean
  taskSources: TaskSourceSettings
}

// Running counts
export interface RunningCounts {
  claude: number
  codex: number
  gemini: number
  opencode: number
  cursor: number
  trae: number
  shell: number
  custom: Record<string, number>
}

// Agent status types
export interface AgentInstallStatus {
  installed: boolean
  cliAvailable: boolean
  mcpEnabled: boolean
  commandInstalled: boolean
}

export interface SwarmStatus {
  mcpEnabled: boolean
  commandInstalled: boolean
  agents: {
    claude: AgentInstallStatus
    codex: AgentInstallStatus
    gemini: AgentInstallStatus
    trae: AgentInstallStatus
  }
}

// Agent detail types (from swarm)
export interface AgentDetail {
  agent_id: string
  agent_type: string
  status: string
  duration: string | null
  started_at: string
  completed_at: string | null
  prompt: string
  cwd: string | null
  files_created: string[]
  files_modified: string[]
  files_deleted: string[]
  bash_commands: string[]
  last_messages: string[]
}

export interface TaskSummary {
  task_name: string
  agent_count: number
  status_counts: { running: number; completed: number; failed: number; stopped: number }
  latest_activity: string
  agents: AgentDetail[]
}

// Terminal types
export interface TerminalDetail {
  id: string
  agentType: string
  label: string | null
  autoLabel: string | null
  createdAt: number
  index: number
  sessionId: string | null
  lastUserMessage?: string
  messageCount?: number
  currentActivity?: string
}

// Session types
export interface AgentSession {
  agentType: 'claude' | 'codex' | 'gemini'
  sessionId: string
  timestamp: string
  path: string
  preview?: string
}

// Context types
export type ContextAgentType = 'claude' | 'gemini' | 'codex' | 'agents' | 'cursor' | 'opencode' | 'trae' | 'unknown'

export interface ContextFile {
  path: string
  agent: ContextAgentType
  preview: string
  lines: number
  isSymlink: boolean
  symlinkTarget?: string
}

// UI types
export type TabId = 'dashboard' | 'workspace' | 'settings'

export type ThemedIcon = { dark: string; light: string }

// VSCode API type
export interface VsCodeApi {
  postMessage(message: unknown): void
  getState(): unknown
  setState(state: unknown): void
}

// Icon config type
export interface IconConfig {
  claude: string
  codex: ThemedIcon
  gemini: string
  opencode: string
  cursor: ThemedIcon
  trae: string
  agents: string
  shell: string
  github: string
}

// Built-in agent config
export interface BuiltInAgentConfig {
  key: string
  name: string
  icon: string | ThemedIcon
}

// Prewarm pool types
export interface PrewarmPool {
  agentType: string
  available: number
  pending: number
}

// Workspace config types
export interface ContextMapping {
  source: string
  aliases: string[]
}

export interface WorkspaceConfig {
  context: ContextMapping[]
}
