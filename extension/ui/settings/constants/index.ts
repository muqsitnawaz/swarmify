import type {
  SwarmAgentType,
  TabId,
  TaskSource,
  NotificationSettings,
  EditorPreferences,
  ThemedIcon,
  BuiltInAgentConfig,
} from '../types'

// Agent models available for each agent type
export const AGENT_MODELS: Record<string, string[]> = {
  claude: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5'],
  codex: ['gpt-5.2-codex', 'gpt-5.1-codex-max'],
  gemini: ['gemini-3-flash', 'gemini-3-pro'],
  cursor: ['composer-1'],
  trae: ['gpt-4o', 'claude-sonnet-4-20250514', 'gemini-2.5-flash'],
  opencode: [],
  shell: []
}

// All swarm-capable agents
export const ALL_SWARM_AGENTS: SwarmAgentType[] = ['claude', 'codex', 'gemini', 'trae']

// Default settings
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: false,
  style: 'native',
  enabledAgents: ['claude']
}

export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = {
  markdownViewerEnabled: true
}

// Source badges for task sources
export const SOURCE_BADGES: Record<TaskSource, { label: string; color: string }> = {
  markdown: { label: 'MD', color: '#6366f1' },
  linear: { label: 'LN', color: '#5e6ad2' },
  github: { label: 'GH', color: '#238636' }
}

// Reserved agent name prefixes (cannot be used for custom agents)
export const RESERVED_NAMES = ['CC', 'CX', 'GX', 'OC', 'CR', 'TR', 'SH']

// Swarm agent display labels
export const SWARM_AGENT_LABELS: Record<SwarmAgentType, string> = {
  codex: 'Codex',
  claude: 'Claude',
  gemini: 'Gemini',
  trae: 'Trae'
}

// Tab display labels
export const TAB_LABELS: Record<TabId, string> = {
  dashboard: 'Dashboard',
  workspace: 'Workspace',
  settings: 'Settings'
}

// Install commands/links for each agent
export const AGENT_INSTALL_INFO: Record<string, { command?: string; url?: string }> = {
  claude: { command: 'npm install -g @anthropic-ai/claude-code' },
  codex: { command: 'npm install -g @openai/codex' },
  gemini: { command: 'npm install -g @anthropic-ai/claude-code', url: 'https://github.com/google-gemini/gemini-cli' },
  trae: { command: 'pipx install "trae-agent[evaluation] @ git+https://github.com/bytedance/trae-agent.git"', url: 'https://github.com/bytedance/trae-agent' },
  opencode: { url: 'https://github.com/opencode-ai/opencode' },
  cursor: { url: 'https://cursor.com' },
}

// Map from agent title (CL, CX, etc.) to key (claude, codex, etc.)
export const AGENT_TITLE_TO_KEY: Record<string, string> = {
  'CC': 'claude',
  'CX': 'codex',
  'GX': 'gemini',
  'OC': 'opencode',
  'CR': 'cursor',
  'TR': 'trae',
  'SH': 'shell',
  'Claude': 'claude',
  'Codex': 'codex',
  'Gemini': 'gemini',
  'OpenCode': 'opencode',
  'Cursor': 'cursor',
  'Trae': 'trae',
  'Shell': 'shell',
}

// Map from key to title (for dropdown)
export const AGENT_KEY_TO_TITLE: Record<string, string> = {
  'claude': 'CC',
  'codex': 'CX',
  'gemini': 'GX',
  'opencode': 'OC',
  'cursor': 'CR',
  'trae': 'TR',
}

// Notification-capable agents
export const NOTIFICATION_AGENTS = [
  { key: 'claude', name: 'Claude', supported: true },
  { key: 'codex', name: 'Codex', supported: false },
  { key: 'gemini', name: 'Gemini', supported: false },
  { key: 'trae', name: 'Trae', supported: false },
  { key: 'opencode', name: 'OpenCode', supported: false },
  { key: 'cursor', name: 'Cursor', supported: false },
  { key: 'shell', name: 'Shell', supported: false },
]

// Markdown rendering allowed tags
export const TODO_MARKDOWN_ALLOWED_TAGS = [
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'li',
  'ol',
  'p',
  'pre',
  'strong',
  'span',
  'ul'
]

// Markdown rendering allowed attributes
export const TODO_MARKDOWN_ALLOWED_ATTRS = ['href', 'title', 'target', 'rel', 'class']

// Sessions per page for pagination
export const SESSIONS_PER_PAGE = 20

// Factory function to create BUILT_IN_AGENTS (needs icons at runtime)
export function createBuiltInAgents(icons: {
  claude: string
  codex: ThemedIcon
  gemini: string
  opencode: string
  cursor: ThemedIcon
  trae: string
  shell: string
}): BuiltInAgentConfig[] {
  return [
    { key: 'claude', name: 'Claude', icon: icons.claude },
    { key: 'codex', name: 'Codex', icon: icons.codex },
    { key: 'gemini', name: 'Gemini', icon: icons.gemini },
    { key: 'opencode', name: 'OpenCode', icon: icons.opencode },
    { key: 'cursor', name: 'Cursor', icon: icons.cursor },
    { key: 'trae', name: 'Trae', icon: icons.trae },
    { key: 'shell', name: 'Shell', icon: icons.shell },
  ]
}
