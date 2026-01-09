import React, { useState, useEffect } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { Button } from './components/ui/button'
import { Checkbox } from './components/ui/checkbox'
import { Input } from './components/ui/input'
import { ChevronDown, ChevronRight, FileEdit, FilePlus, Terminal, MessageSquare, Clock, RefreshCw, Download, ExternalLink, Check } from 'lucide-react'

interface BuiltInAgentSettings {
  login: boolean
  instances: number
  defaultModel?: string
}

interface CustomAgentSettings {
  name: string
  command: string
  login: boolean
  instances: number
}

interface CommandAlias {
  name: string
  agent: string
  flags: string
}

type SwarmAgentType = 'claude' | 'codex' | 'gemini'
const ALL_SWARM_AGENTS: SwarmAgentType[] = ['claude', 'codex', 'gemini']
const AGENT_MODELS: Record<string, string[]> = {
  claude: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5'],
  codex: ['gpt-5.2-codex', 'gpt-5.1-codex-max'],
  gemini: ['gemini-3-flash', 'gemini-3-pro'],
  cursor: ['composer-1'],
  opencode: [],
  shell: []
}
const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: false,
  style: 'native',
  enabledAgents: ['claude']
}

type SkillName =
  | 'plan'
  | 'splan'
  | 'debug'
  | 'sdebug'
  | 'sconfirm'
  | 'clean'
  | 'sclean'
  | 'test'
  | 'stest'

interface SkillAgentStatus {
  installed: boolean
  cliAvailable: boolean
  builtIn: boolean
}

interface SkillCommandStatus {
  name: SkillName
  description: string
  agents: Record<SwarmAgentType, SkillAgentStatus>
}

interface SkillsStatus {
  commands: SkillCommandStatus[]
}

interface PromptEntry {
  id: string
  title: string
  content: string
  isFavorite: boolean
  createdAt: number
  updatedAt: number
  accessedAt: number
}

interface AgentSettings {
  builtIn: {
    claude: BuiltInAgentSettings
    codex: BuiltInAgentSettings
    gemini: BuiltInAgentSettings
    opencode: BuiltInAgentSettings
    cursor: BuiltInAgentSettings
    shell: BuiltInAgentSettings
  }
  custom: CustomAgentSettings[]
  aliases: CommandAlias[]
  swarmEnabledAgents: SwarmAgentType[]
  prompts: PromptEntry[]
  display: DisplayPreferences
  notifications?: NotificationSettings
}

interface DisplayPreferences {
  showFullAgentNames: boolean
  showLabelsInTitles: boolean
}

interface NotificationSettings {
  enabled: boolean
  style: 'native' | 'vscode'
  enabledAgents: string[]
}

interface RunningCounts {
  claude: number
  codex: number
  gemini: number
  opencode: number
  cursor: number
  shell: number
  custom: Record<string, number>
}

interface AgentInstallStatus {
  installed: boolean
  cliAvailable: boolean
  mcpEnabled: boolean
  commandInstalled: boolean
}

interface SwarmStatus {
  mcpEnabled: boolean
  commandInstalled: boolean
  agents: {
    claude: AgentInstallStatus
    codex: AgentInstallStatus
    gemini: AgentInstallStatus
  }
}

interface AgentDetail {
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

interface TaskSummary {
  task_name: string
  agent_count: number
  status_counts: { running: number; completed: number; failed: number; stopped: number }
  latest_activity: string
  agents: AgentDetail[]
}

interface TerminalDetail {
  id: string
  agentType: string
  label: string | null
  autoLabel: string | null
  createdAt: number
  index: number
}

interface TodoItem {
  title: string
  description?: string
  completed: boolean
  line: number
}

interface TodoFile {
  path: string
  items: TodoItem[]
}

interface AgentSession {
  agentType: 'claude' | 'codex' | 'gemini'
  sessionId: string
  timestamp: string
  path: string
  preview?: string
}

type TabId = 'overview' | 'tasks' | 'sessions' | 'settings' | 'swarm' | 'skills' | 'guide'

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void
  getState(): unknown
  setState(state: unknown): void
}

declare global {
  interface Window {
    __ICONS__: {
      claude: string
      codex: string
      gemini: string
      opencode: string
      cursor: string
      agents: string
      shell: string
    }
  }
}

const vscode = acquireVsCodeApi()
const icons = window.__ICONS__

const todoMarkdownRenderer = new marked.Renderer()

const escapeHtml = (value: string) => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

todoMarkdownRenderer.link = (href, title, text) => {
  const safeHref = href || '#'
  const safeTitle = title ? ` title="${title}"` : ''
  return `<a href="${safeHref}"${safeTitle} target="_blank" rel="noreferrer">${text}</a>`
}

todoMarkdownRenderer.code = (code, infostring) => {
  const lang = (infostring || '').trim()
  const className = lang ? ` class="todo-md-code language-${lang}"` : ' class="todo-md-code"'
  return `<pre class="todo-md-pre"><code${className}>${escapeHtml(code)}</code></pre>`
}

marked.setOptions({
  gfm: true,
  breaks: true,
  headerIds: false,
  mangle: false,
  renderer: todoMarkdownRenderer
})

const todoMarkdownAllowedTags = [
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

const todoMarkdownAllowedAttrs = ['href', 'title', 'target', 'rel', 'class']

function renderTodoDescription(desc: string, clamp: boolean = true) {
  const raw = marked.parse(desc)
  const safe = DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: todoMarkdownAllowedTags,
    ALLOWED_ATTR: todoMarkdownAllowedAttrs
  })
  const className = clamp ? 'todo-md todo-md-clamp' : 'todo-md'
  return <div className={className} dangerouslySetInnerHTML={{ __html: safe }} />
}

const BUILT_IN_AGENTS = [
  { key: 'claude', name: 'Claude', icon: icons.claude },
  { key: 'codex', name: 'Codex', icon: icons.codex },
  { key: 'gemini', name: 'Gemini', icon: icons.gemini },
  { key: 'opencode', name: 'OpenCode', icon: icons.opencode },
  { key: 'cursor', name: 'Cursor', icon: icons.cursor },
  { key: 'shell', name: 'Shell', icon: icons.shell },
] as const

const RESERVED_NAMES = ['CC', 'CX', 'GX', 'OC', 'CR', 'SH']
const SWARM_AGENT_LABELS: Record<SwarmAgentType, string> = {
  codex: 'Codex',
  claude: 'Claude',
  gemini: 'Gemini'
}

const TAB_LABELS: Record<TabId, string> = {
  overview: 'Overview',
  tasks: 'Todo',
  sessions: 'Sessions',
  swarm: 'Swarm',
  skills: 'Skills',
  settings: 'Settings',
  guide: 'Guide'
}

const SKILL_AGENTS: { key: SwarmAgentType; name: string; icon: string }[] = [
  { key: 'codex', name: 'Codex', icon: icons.codex },
  { key: 'gemini', name: 'Gemini', icon: icons.gemini },
  { key: 'claude', name: 'Claude', icon: icons.claude },
]

// Install commands/links for each agent
const AGENT_INSTALL_INFO: Record<string, { command?: string; url?: string }> = {
  claude: { command: 'npm install -g @anthropic-ai/claude-code' },
  codex: { command: 'npm install -g @openai/codex' },
  gemini: { command: 'npm install -g @anthropic-ai/claude-code', url: 'https://github.com/google-gemini/gemini-cli' },
  opencode: { url: 'https://github.com/opencode-ai/opencode' },
  cursor: { url: 'https://cursor.com' },
}

// Map from agent title (CC, CX, etc.) to key (claude, codex, etc.)
const AGENT_TITLE_TO_KEY: Record<string, string> = {
  'CC': 'claude',
  'CX': 'codex',
  'GX': 'gemini',
  'OC': 'opencode',
  'CR': 'cursor',
  'SH': 'shell',
  'Claude': 'claude',
  'Codex': 'codex',
  'Gemini': 'gemini',
  'OpenCode': 'opencode',
  'Cursor': 'cursor',
  'Shell': 'shell',
}

// Map from key to title (for dropdown)
const AGENT_KEY_TO_TITLE: Record<string, string> = {
  'claude': 'CC',
  'codex': 'CX',
  'gemini': 'GX',
  'opencode': 'OC',
  'cursor': 'CR',
}

const NOTIFICATION_AGENTS = [
  { key: 'claude', name: 'Claude', supported: true },
  { key: 'codex', name: 'Codex', supported: false },
  { key: 'gemini', name: 'Gemini', supported: false },
  { key: 'opencode', name: 'OpenCode', supported: false },
  { key: 'cursor', name: 'Cursor', supported: false },
  { key: 'shell', name: 'Shell', supported: false },
]

export default function App() {
  const [settings, setSettings] = useState<AgentSettings | null>(null)
  const [runningCounts, setRunningCounts] = useState<RunningCounts>({
    claude: 0, codex: 0, gemini: 0, opencode: 0, cursor: 0, shell: 0, custom: {}
  })
  const [swarmStatus, setSwarmStatus] = useState<SwarmStatus>({
    mcpEnabled: false,
    commandInstalled: false,
    agents: {
      claude: { installed: false, cliAvailable: false, mcpEnabled: false, commandInstalled: false },
      codex: { installed: false, cliAvailable: false, mcpEnabled: false, commandInstalled: false },
      gemini: { installed: false, cliAvailable: false, mcpEnabled: false, commandInstalled: false },
    }
  })
  const [isAdding, setIsAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCommand, setNewCommand] = useState('')
  const [nameError, setNameError] = useState('')

  // Alias editing state
  const [isAddingAlias, setIsAddingAlias] = useState(false)
  const [newAliasName, setNewAliasName] = useState('')
  const [newAliasAgent, setNewAliasAgent] = useState('claude')
  const [newAliasFlags, setNewAliasFlags] = useState('')
  const [aliasError, setAliasError] = useState('')

  // Skills state
  const [skillsStatus, setSkillsStatus] = useState<SkillsStatus | null>(null)
  const [skillInstalling, setSkillInstalling] = useState(false)

  // Tab and Tasks state
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [tasksLoaded, setTasksLoaded] = useState(false)
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set())
  const [tasksPage, setTasksPage] = useState(1)
  const TASKS_PER_PAGE = 10
  const [swarmInstalling, setSwarmInstalling] = useState(false)

  const [todoFiles, setTodoFiles] = useState<TodoFile[]>([])
  const [todoLoading, setTodoLoading] = useState(false)
  const [todoLoaded, setTodoLoaded] = useState(false)

  const [recentSessions, setRecentSessions] = useState<AgentSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [sessionsPage, setSessionsPage] = useState(1)
  const SESSIONS_PER_PAGE = 20

  // Agent terminals drill-down state
  const [selectedAgentType, setSelectedAgentType] = useState<string | null>(null)
  const [agentTerminals, setAgentTerminals] = useState<TerminalDetail[]>([])
  const [agentTerminalsLoading, setAgentTerminalsLoading] = useState(false)

  // Default agent and installed agents state
  const [defaultAgent, setDefaultAgent] = useState<string>('CC')
  const [installedAgents, setInstalledAgents] = useState<Record<string, boolean>>({
    claude: true, codex: true, gemini: true, opencode: true, cursor: true, shell: true
  })

  // Session pre-warming state
  const [prewarmEnabled, setPrewarmEnabled] = useState(false)
  const [prewarmPools, setPrewarmPools] = useState<Array<{
    agentType: 'claude' | 'codex' | 'gemini'
    available: number
    pending: number
    sessions: Array<{ sessionId: string; createdAt: number; workingDirectory: string }>
  }>>([])
  const [prewarmLoaded, setPrewarmLoaded] = useState(false)

  const hasCliInstalled = installedAgents.claude || installedAgents.codex || installedAgents.gemini
  const showIntegrationCallout = !hasCliInstalled && !swarmStatus.mcpEnabled

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data
      if (message.type === 'init') {
        setSettings(message.settings)
        setRunningCounts(message.runningCounts)
        if (message.swarmStatus) {
          setSwarmStatus(message.swarmStatus)
        }
        if (message.skillsStatus) {
          setSkillsStatus(message.skillsStatus)
        }
      } else if (message.type === 'updateRunningCounts') {
        setRunningCounts(message.counts)
      } else if (message.type === 'tasksData') {
        setTasks(message.tasks || [])
        setTasksLoading(false)
        setTasksLoaded(true)
      } else if (message.type === 'todoFilesData' || message.type === 'todoFilesUpdated') {
        setTodoFiles(message.files || [])
        setTodoLoading(false)
        setTodoLoaded(true)
      } else if (message.type === 'sessionsData' || message.type === 'sessionsUpdated') {
        setRecentSessions(message.sessions || [])
        setSessionsLoading(false)
        setSessionsLoaded(true)
      } else if (message.type === 'agentTerminalsData') {
        setAgentTerminals(message.terminals || [])
        setAgentTerminalsLoading(false)
      } else if (message.type === 'installedAgentsData') {
        setInstalledAgents(message.installedAgents)
      } else if (message.type === 'defaultAgentData') {
        setDefaultAgent(message.defaultAgent)
      } else if (message.type === 'swarmStatus') {
        if (message.swarmStatus) setSwarmStatus(message.swarmStatus)
      } else if (message.type === 'skillsStatus') {
        if (message.skillsStatus) setSkillsStatus(message.skillsStatus)
      } else if (message.type === 'swarmInstallStart') {
        setSwarmInstalling(true)
      } else if (message.type === 'swarmInstallDone') {
        setSwarmInstalling(false)
      } else if (message.type === 'skillInstallStart') {
        setSkillInstalling(true)
      } else if (message.type === 'skillInstallDone') {
        setSkillInstalling(false)
      } else if (message.type === 'prewarmStatus') {
        setPrewarmEnabled(message.enabled)
        setPrewarmPools(message.pools || [])
        setPrewarmLoaded(true)
      }
    }

    window.addEventListener('message', handleMessage)
    vscode.postMessage({ type: 'ready' })
    // Request installed agents and default agent
    vscode.postMessage({ type: 'checkInstalledAgents' })
    vscode.postMessage({ type: 'getDefaultAgent' })
    vscode.postMessage({ type: 'getPrewarmStatus' })

    return () => window.removeEventListener('message', handleMessage)
  }, [])

  // Fetch tasks when switching to swarm tab (only if not already loaded)
  useEffect(() => {
    if ((activeTab === 'swarm' || activeTab === 'overview') && !tasksLoaded && !tasksLoading) {
      fetchTasks()
    }
  }, [activeTab, tasksLoaded, tasksLoading])

  useEffect(() => {
    if (activeTab === 'tasks' && !todoLoaded && !todoLoading) {
      fetchTodoFiles()
    }
  }, [activeTab, todoLoaded, todoLoading])

  useEffect(() => {
    if (activeTab === 'sessions' && !sessionsLoaded && !sessionsLoading) {
      fetchSessions()
    }
  }, [activeTab, sessionsLoaded, sessionsLoading])

  const fetchTasks = () => {
    setTasksLoading(true)
    vscode.postMessage({ type: 'fetchTasks' })
  }

  const fetchTodoFiles = () => {
    setTodoLoading(true)
    vscode.postMessage({ type: 'fetchTodoFiles' })
  }

  const fetchSessions = () => {
    setSessionsLoading(true)
    setSessionsPage(1)
    vscode.postMessage({ type: 'fetchSessions', limit: 200 })
  }

  const togglePrewarm = () => {
    vscode.postMessage({ type: 'togglePrewarm' })
  }

  const handleAgentClick = (agentKey: string) => {
    if (selectedAgentType === agentKey) {
      // Toggle off if already selected
      setSelectedAgentType(null)
      setAgentTerminals([])
    } else {
      setSelectedAgentType(agentKey)
      setAgentTerminalsLoading(true)
      vscode.postMessage({ type: 'fetchAgentTerminals', agentType: agentKey })
    }
  }

  const handleSpawnTodo = (item: TodoItem, filePath: string) => {
    setActiveTab('swarm')
    vscode.postMessage({ type: 'spawnSwarmForTodo', item, filePath })
  }

  const handleOpenSession = (session: AgentSession) => {
    vscode.postMessage({ type: 'openSession', session })
  }

  const formatTimeSince = (timestamp: number): string => {
    const now = Date.now()
    const diffMs = now - timestamp
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'just started'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    return `${diffDays}d ago`
  }

  const getAgentDisplayName = (agentKey: string): string => {
    const agent = BUILT_IN_AGENTS.find(a => a.key === agentKey)
    return agent?.name || agentKey.charAt(0).toUpperCase() + agentKey.slice(1)
  }

  const toggleTaskExpanded = (taskName: string) => {
    setExpandedTasks(prev => {
      const next = new Set(prev)
      if (next.has(taskName)) {
        next.delete(taskName)
      } else {
        next.add(taskName)
      }
      return next
    })
  }

  const toggleAgentExpanded = (agentId: string) => {
    setExpandedAgents(prev => {
      const next = new Set(prev)
      if (next.has(agentId)) {
        next.delete(agentId)
      } else {
        next.add(agentId)
      }
      return next
    })
  }

  const formatTimeAgo = (isoDate: string): string => {
    const date = new Date(isoDate)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins === 1) return '1 min ago'
    if (diffMins < 60) return `${diffMins} mins ago`
    if (diffHours === 1) return '1 hour ago'
    if (diffHours < 24) return `${diffHours} hours ago`
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    return `${Math.floor(diffDays / 7)} weeks ago`
  }

  const formatSessionTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return 'Unknown time'
    return date.toLocaleString()
  }

  const formatTimeAgoSafe = (timestamp: string): string => {
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return 'Unknown time'
    return formatTimeAgo(timestamp)
  }

  const formatPreview = (preview?: string, maxWords: number = 20): string => {
    if (!preview) return 'No preview available.'
    const compact = preview.replace(/\s+/g, ' ').trim()
    if (!compact) return 'No preview available.'
    const words = compact.split(' ')
    if (words.length <= maxWords) return compact
    return `${words.slice(0, maxWords).join(' ')}...`
  }

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'running': return 'text-blue-400'
      case 'completed': return 'text-green-400'
      case 'failed': return 'text-red-400'
      case 'stopped': return 'text-yellow-400'
      default: return 'text-[var(--muted-foreground)]'
    }
  }

  const getStatusBg = (status: string): string => {
    switch (status) {
      case 'running': return 'bg-blue-500/20'
      case 'completed': return 'bg-green-500/20'
      case 'failed': return 'bg-red-500/20'
      case 'stopped': return 'bg-yellow-500/20'
      default: return 'bg-[var(--muted)]'
    }
  }

  // Format task name: convert kebab-case to Title Case
  const formatTaskName = (name: string): string => {
    return name
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ')
  }

  // Get unique agent types from a task
  const getUniqueAgentTypes = (agents: AgentDetail[]): string[] => {
    return [...new Set(agents.map(a => a.agent_type))]
  }

  const getTaskLatestTime = (task: TaskSummary): string | null => {
    const parsedAgents = task.agents
      .flatMap(a => [a.completed_at, a.started_at].filter(Boolean))
      .map(t => new Date(t as string).getTime())
      .filter(n => !Number.isNaN(n));

    if (parsedAgents.length > 0) {
      return new Date(Math.max(...parsedAgents)).toISOString();
    }

    if (task.latest_activity) {
      const parsed = new Date(task.latest_activity).getTime();
      if (!Number.isNaN(parsed)) {
        return new Date(parsed).toISOString();
      }
    }

    return null;
  }

  const handleInstallSwarmAgent = (agent: SwarmAgentType) => {
    setSwarmInstalling(true)
    vscode.postMessage({ type: 'installSwarmAgent', agent })
  }

  const saveSettings = (newSettings: AgentSettings) => {
    setSettings(newSettings)
    vscode.postMessage({ type: 'saveSettings', settings: newSettings })
  }

  const updateBuiltIn = (key: keyof AgentSettings['builtIn'], field: 'login' | 'instances', value: boolean | number) => {
    if (!settings) return
    const newSettings = {
      ...settings,
      builtIn: {
        ...settings.builtIn,
        [key]: { ...settings.builtIn[key], [field]: value }
      }
    }
    saveSettings(newSettings)
  }

  const updateBuiltInModel = (key: keyof AgentSettings['builtIn'], value: string) => {
    if (!settings) return
    const newSettings = {
      ...settings,
      builtIn: {
        ...settings.builtIn,
        [key]: { ...settings.builtIn[key], defaultModel: value || undefined }
      }
    }
    saveSettings(newSettings)
  }

  const updateDisplay = (field: keyof DisplayPreferences, value: boolean) => {
    if (!settings) return
    const newSettings = {
      ...settings,
      display: {
        ...settings.display,
        [field]: value
      }
    }
    saveSettings(newSettings)
  }

  const updateCustom = (index: number, field: 'login' | 'instances', value: boolean | number) => {
    if (!settings) return
    const newCustom = [...settings.custom]
    newCustom[index] = { ...newCustom[index], [field]: value }
    saveSettings({ ...settings, custom: newCustom })
  }

  const updateNotifications = (updates: Partial<NotificationSettings>) => {
    if (!settings) return
    const current = settings.notifications ?? DEFAULT_NOTIFICATION_SETTINGS
    const next: NotificationSettings = {
      ...current,
      ...updates
    }
    saveSettings({ ...settings, notifications: next })
  }

  const toggleSwarmAgent = (agent: SwarmAgentType, enabled: boolean) => {
    if (!settings) return
    const current = settings.swarmEnabledAgents || ALL_SWARM_AGENTS
    const newEnabled = enabled
      ? [...current, agent].filter((v, i, a) => a.indexOf(v) === i)
      : current.filter(a => a !== agent)
    saveSettings({ ...settings, swarmEnabledAgents: newEnabled })
  }

  const isSwarmAgentEnabled = (agent: SwarmAgentType): boolean => {
    if (!settings) return true
    const enabled = settings.swarmEnabledAgents || ALL_SWARM_AGENTS
    return enabled.includes(agent)
  }

  const handleSetDefaultAgent = (agentTitle: string) => {
    setDefaultAgent(agentTitle)
    vscode.postMessage({ type: 'setDefaultAgent', agentTitle })
  }

  const isAgentInstalled = (agentKey: string): boolean => {
    return installedAgents[agentKey] ?? true
  }

  const getInstallInfo = (agentKey: string) => {
    return AGENT_INSTALL_INFO[agentKey]
  }

  const validateName = (name: string): string => {
    const upper = name.toUpperCase()
    if (upper.length === 0) return 'Name required'
    if (upper.length > 2) return 'Max 2 characters'
    if (!/^[A-Z]+$/.test(upper)) return 'Letters only'
    if (RESERVED_NAMES.includes(upper)) return 'Name already used'
    if (settings?.custom.some(a => a.name === upper)) return 'Name already used'
    return ''
  }

  const handleNameChange = (value: string) => {
    const upper = value.toUpperCase().slice(0, 2)
    setNewName(upper)
    setNameError(validateName(upper))
  }

  const handleAddClick = () => {
    setIsAdding(true)
    setNewName('')
    setNewCommand('')
    setNameError('')
  }

  const handleCancelAdd = () => {
    setIsAdding(false)
    setNewName('')
    setNewCommand('')
    setNameError('')
  }

  const handleSave = () => {
    const error = validateName(newName)
    if (error) {
      setNameError(error)
      return
    }
    if (!newCommand.trim()) {
      setNameError('Command required')
      return
    }
    if (!settings) return

    const newAgent: CustomAgentSettings = {
      name: newName.toUpperCase(),
      command: newCommand.trim(),
      login: false,
      instances: 1
    }
    saveSettings({ ...settings, custom: [...settings.custom, newAgent] })
    setIsAdding(false)
    setNewName('')
    setNewCommand('')
    setNameError('')
  }

  const removeCustomAgent = (index: number) => {
    if (!settings) return
    const newCustom = settings.custom.filter((_, i) => i !== index)
    saveSettings({ ...settings, custom: newCustom })
  }

  // Alias management functions
  const validateAliasName = (name: string): string => {
    if (!name.trim()) return 'Name required'
    if (name.length > 20) return 'Max 20 characters'
    if (settings?.aliases?.some(a => a.name.toLowerCase() === name.toLowerCase())) return 'Name already used'
    return ''
  }

  const handleAliasNameChange = (value: string) => {
    setNewAliasName(value)
    setAliasError(validateAliasName(value))
  }

  const handleAddAliasClick = () => {
    setIsAddingAlias(true)
    setNewAliasName('')
    setNewAliasAgent('claude')
    setNewAliasFlags('')
    setAliasError('')
  }

  const handleCancelAddAlias = () => {
    setIsAddingAlias(false)
    setNewAliasName('')
    setNewAliasAgent('claude')
    setNewAliasFlags('')
    setAliasError('')
  }

  const handleSaveAlias = () => {
    const error = validateAliasName(newAliasName)
    if (error) {
      setAliasError(error)
      return
    }
    if (!newAliasFlags.trim()) {
      setAliasError('Flags required')
      return
    }
    if (!settings) return

    const newAlias: CommandAlias = {
      name: newAliasName.trim(),
      agent: newAliasAgent,
      flags: newAliasFlags.trim()
    }
    const aliases = settings.aliases || []
    saveSettings({ ...settings, aliases: [...aliases, newAlias] })
    handleCancelAddAlias()
  }

  const removeAlias = (index: number) => {
    if (!settings) return
    const aliases = settings.aliases || []
    const newAliases = aliases.filter((_, i) => i !== index)
    saveSettings({ ...settings, aliases: newAliases })
  }

  if (!settings) {
    return <div className="text-[var(--muted-foreground)]">Loading...</div>
  }

  // Get paginated tasks
  const paginatedTasks = tasks.slice((tasksPage - 1) * TASKS_PER_PAGE, tasksPage * TASKS_PER_PAGE)

  // Render Tasks tab content
  const renderTasksTab = () => (
    <div className="space-y-4">
      {/* Tasks list */}
      {tasksLoading && tasks.length === 0 ? (
        <div className="text-center py-8 text-[var(--muted-foreground)]">Loading tasks...</div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-8 text-[var(--muted-foreground)]">
          No tasks found. Spawn agents via /swarm to see them here.
        </div>
      ) : (
        <div className="space-y-3">
          {paginatedTasks.map(task => {
            const isTaskExpanded = expandedTasks.has(task.task_name)
            const agentTypes = getUniqueAgentTypes(task.agents)
            return (
              <div key={task.task_name} className="rounded-xl bg-[var(--muted)] overflow-hidden">
                {/* Task header */}
                <button
                  onClick={() => toggleTaskExpanded(task.task_name)}
                  className="w-full px-4 py-3 hover:bg-[var(--muted-foreground)]/5 transition-colors text-left"
                >
                  <div className="grid grid-cols-[auto,1fr,auto] gap-x-3 gap-y-1 items-center">
                    {isTaskExpanded ? (
                      <ChevronDown className="w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0" />
                    )}
                    <span className="text-sm font-medium truncate">{formatTaskName(task.task_name)}</span>
                    <div className="row-span-2 flex items-center gap-1.5 flex-shrink-0">
                      {agentTypes.map(type => (
                        <img
                          key={type}
                          src={icons[type as keyof typeof icons] || icons.agents}
                          alt={type}
                          className="w-4 h-4"
                          title={type}
                        />
                      ))}
                    </div>
                    <div className="ml-7 text-xs text-[var(--muted-foreground)]">
                      {getTaskLatestTime(task) ? formatTimeAgo(getTaskLatestTime(task) as string) : '—'}
                    </div>
                  </div>
                </button>

                {/* Expanded task content */}
                {isTaskExpanded && (
                  <div className="border-t border-[var(--border)] px-4 py-3 space-y-3">
                    {task.agents.map(agent => {
                      const isAgentExpanded = expandedAgents.has(agent.agent_id)
                      const hasDetails = agent.files_created.length > 0 ||
                        agent.files_modified.length > 0 ||
                        agent.bash_commands.length > 0 ||
                        agent.last_messages.length > 0

                      return (
                        <div key={agent.agent_id} className="rounded-lg bg-[var(--background)] border border-[var(--border)]">
                          {/* Agent header */}
                          <button
                            onClick={() => hasDetails && toggleAgentExpanded(agent.agent_id)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 ${hasDetails ? 'cursor-pointer hover:bg-[var(--muted)]/50' : 'cursor-default'}`}
                            disabled={!hasDetails}
                          >
                            {hasDetails ? (
                              isAgentExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                              )
                            ) : (
                              <div className="w-3.5 h-3.5" />
                            )}
                            <img
                              src={icons[agent.agent_type as keyof typeof icons] || icons.agents}
                              alt={agent.agent_type}
                              className="w-4 h-4"
                            />
                            <span className="text-sm font-medium capitalize">{agent.agent_type}</span>
                            <span className="text-xs text-[var(--muted-foreground)] font-mono">{agent.agent_id}</span>
                            <span className={`px-1.5 py-0.5 text-xs rounded ${getStatusBg(agent.status)} ${getStatusColor(agent.status)}`}>
                              {agent.status}
                            </span>
                            {agent.duration && (
                              <span className="text-xs text-[var(--muted-foreground)] flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {agent.duration}
                              </span>
                            )}
                          </button>

                          {/* Agent details */}
                          {isAgentExpanded && hasDetails && (
                            <div className="border-t border-[var(--border)] px-3 py-2.5 space-y-3 text-xs">
                              {/* Prompt */}
                              {agent.prompt && (
                                <div>
                                  <div className="text-[var(--muted-foreground)] mb-1">Prompt</div>
                                  <div className="text-[var(--foreground)] bg-[var(--muted)] rounded px-2 py-1.5 whitespace-pre-wrap">
                                    {agent.prompt}
                                  </div>
                                </div>
                              )}

                              {/* Files created */}
                              {agent.files_created.length > 0 && (
                                <div>
                                  <div className="flex items-center gap-1.5 text-[var(--muted-foreground)] mb-1">
                                    <FilePlus className="w-3.5 h-3.5 text-green-400" />
                                    Files Created ({agent.files_created.length})
                                  </div>
                                  <div className="space-y-0.5">
                                    {agent.files_created.map((f, i) => (
                                      <div key={i} className="font-mono text-green-400 truncate">{f}</div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Files modified */}
                              {agent.files_modified.length > 0 && (
                                <div>
                                  <div className="flex items-center gap-1.5 text-[var(--muted-foreground)] mb-1">
                                    <FileEdit className="w-3.5 h-3.5 text-yellow-400" />
                                    Files Modified ({agent.files_modified.length})
                                  </div>
                                  <div className="space-y-0.5">
                                    {agent.files_modified.map((f, i) => (
                                      <div key={i} className="font-mono text-yellow-400 truncate">{f}</div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Bash commands */}
                              {agent.bash_commands.length > 0 && (
                                <div>
                                  <div className="flex items-center gap-1.5 text-[var(--muted-foreground)] mb-1">
                                    <Terminal className="w-3.5 h-3.5" />
                                    Commands ({agent.bash_commands.length})
                                  </div>
                                  <div className="space-y-0.5 font-mono bg-[var(--muted)] rounded px-2 py-1.5">
                                    {agent.bash_commands.map((cmd, i) => (
                                      <div key={i} className="text-[var(--foreground)] truncate">$ {cmd}</div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Last messages */}
                              {agent.last_messages.length > 0 && (
                                <div>
                                  <div className="flex items-center gap-1.5 text-[var(--muted-foreground)] mb-1">
                                    <MessageSquare className="w-3.5 h-3.5" />
                                    Last Messages
                                  </div>
                                  <div className="space-y-1.5">
                                    {agent.last_messages.map((msg, i) => (
                                      <div key={i} className="bg-[var(--muted)] rounded px-2 py-1.5 text-[var(--foreground)] whitespace-pre-wrap">
                                        {msg}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  const renderTodoTab = () => (
    <div className="space-y-4">
      {todoLoading && todoFiles.length === 0 ? (
        <div className="text-center py-8 text-[var(--muted-foreground)]">Loading tasks...</div>
      ) : todoFiles.length === 0 ? (
        <div className="text-center py-8 text-[var(--muted-foreground)]">
          No TODO.md items found in this workspace.
        </div>
      ) : (
        <div className="space-y-3">
          {todoFiles.map(file => (
            <div key={file.path} className="rounded-xl bg-[var(--muted)] px-4 py-3 space-y-3">
              <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                <span className="uppercase tracking-wide">File</span>
                <span className="truncate">{file.path}</span>
                <span className="ml-auto">{file.items.length} items</span>
              </div>
              {file.items.length === 0 ? (
                <div className="text-xs text-[var(--muted-foreground)]">No tasks in this file.</div>
              ) : (
                <div className="space-y-2">
                  {file.items.map((item, index) => (
                    <div key={`${file.path}-${index}-${item.line}`} className="flex items-start gap-3">
                      <span
                        className={`mt-0.5 rounded px-2 py-0.5 text-xs ${
                          item.completed
                            ? 'bg-[var(--secondary)] text-[var(--muted-foreground)]'
                            : 'bg-[var(--background)] text-[var(--foreground)]'
                        }`}
                      >
                        {item.completed ? 'Completed' : 'Open'}
                      </span>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium ${item.completed ? 'line-through text-[var(--muted-foreground)]' : ''}`}>
                            {item.title || 'Untitled task'}
                          </span>
                          <span className="text-xs text-[var(--muted-foreground)]">Line {item.line}</span>
                        </div>
                        {item.description && (
                          <div className="text-xs text-[var(--muted-foreground)] space-y-2">
                            {renderTodoDescription(item.description, true)}
                          </div>
                        )}
                      </div>
                      {!item.completed && (
                        <Button size="sm" onClick={() => handleSpawnTodo(item, file.path)}>
                          Spawn Swarm
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )

  const renderSessionsTab = () => {
    const sorted = [...recentSessions].sort((a, b) => {
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    })
    const totalPages = Math.max(1, Math.ceil(sorted.length / SESSIONS_PER_PAGE))
    const safePage = Math.min(sessionsPage, totalPages)
    const start = (safePage - 1) * SESSIONS_PER_PAGE
    const pageSessions = sorted.slice(start, start + SESSIONS_PER_PAGE)

    return (
      <div className="space-y-4">
        {sessionsLoading && recentSessions.length === 0 ? (
          <div className="text-center py-8 text-[var(--muted-foreground)]">Loading sessions...</div>
        ) : recentSessions.length === 0 ? (
          <div className="text-center py-8 text-[var(--muted-foreground)]">No recent sessions found.</div>
        ) : (
          <div className="rounded-xl bg-[var(--muted)] overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-[var(--muted-foreground)] border-b border-[var(--border)]">
                <tr>
                  <th className="px-4 py-3 w-24">Agent</th>
                  <th className="px-4 py-3">Session</th>
                  <th className="px-4 py-3 w-48">Time</th>
                  <th className="px-4 py-3">Preview</th>
                  <th className="px-4 py-3 w-24 text-right">Open</th>
                </tr>
              </thead>
              <tbody>
                {pageSessions.map(session => {
                  return (
                    <tr key={session.path} className="border-b border-[var(--border)] last:border-b-0">
                      <td className="px-4 py-3">
                        <span className="text-xs font-medium">
                          {getAgentDisplayName(session.agentType)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium">{session.sessionId}</td>
                      <td className="px-4 py-3 text-xs text-[var(--muted-foreground)]">
                        <div>{formatSessionTimestamp(session.timestamp)}</div>
                        <div>{formatTimeAgoSafe(session.timestamp)}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--muted-foreground)]">
                        <div className="max-h-12 overflow-hidden break-words">
                          {formatPreview(session.preview)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" onClick={() => handleOpenSession(session)}>
                          Open
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {recentSessions.length > 0 && (
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSessionsPage(p => Math.max(1, p - 1))}
              disabled={safePage === 1}
            >
              Previous
            </Button>
            <span className="text-sm text-[var(--muted-foreground)]">
              Page {safePage} of {totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSessionsPage(p => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    )
  }

  const basicSkills = skillsStatus?.commands.filter(skill => !skill.name.startsWith('s')) || []
  const swarmSkills = skillsStatus?.commands.filter(skill => skill.name.startsWith('s')) || []

  return (
    <div className="space-y-6">
      {/* Header with tabs */}
      <header className="pb-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-3 mb-4">
          <img src={icons.agents} alt="Agents" className="w-10 h-10" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Agents</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              Multi-agent coding
            </p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1">
          {(['overview', 'tasks', 'sessions', 'swarm', 'skills', 'settings', 'guide'] as TabId[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors capitalize ${
                activeTab === tab
                  ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]'
              }`}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      </header>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="space-y-8">
          {showIntegrationCallout && (
            <section className="px-4 py-3 rounded-xl bg-[var(--muted)] border border-[var(--border)]">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--background)]">
                  <img src={icons.agents} alt="Agents" className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold">Swarm Integration</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Install a CLI agent and enable Swarm to see tasks here.
                  </p>
                </div>
                <Button size="sm" onClick={() => setActiveTab('swarm')}>
                  Configure
                </Button>
              </div>
            </section>
          )}

          {/* Running Now */}
          <section>
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)] mb-4">
              Running Now
            </h2>
            <div className="flex flex-wrap gap-3">
              {BUILT_IN_AGENTS.map(agent => {
                const count = runningCounts[agent.key as keyof typeof runningCounts] as number
                const isSelected = selectedAgentType === agent.key
                return (
                  <div
                    key={agent.key}
                    onClick={() => count > 0 && handleAgentClick(agent.key)}
                    className={`group flex items-center gap-2.5 px-4 py-2.5 rounded-xl transition-colors ${
                      isSelected
                        ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                        : 'bg-[var(--muted)]'
                    } ${count > 0 ? 'cursor-pointer hover:bg-[var(--muted-foreground)]/10' : ''}`}
                  >
                    <img src={agent.icon} alt={agent.name} className="w-5 h-5" />
                    <span className="text-sm font-medium">{agent.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        vscode.postMessage({ type: 'spawnAgent', agentKey: agent.key })
                      }}
                      className={`w-6 text-center text-base font-semibold tabular-nums transition-colors ${isSelected ? '' : 'text-[var(--foreground)]'} hover:text-[var(--primary)]`}
                    >
                      <span className="group-hover:hidden">{count}</span>
                      <span className="hidden group-hover:inline">+</span>
                    </button>
                  </div>
                )
              })}
              {Object.entries(runningCounts.custom).map(([name, count]) => {
                const isSelected = selectedAgentType === name
                return (
                  <div
                    key={name}
                    onClick={() => count > 0 && handleAgentClick(name)}
                    className={`group flex items-center gap-2.5 px-4 py-2.5 rounded-xl transition-colors ${
                      isSelected
                        ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                        : 'bg-[var(--muted)]'
                    } ${count > 0 ? 'cursor-pointer hover:bg-[var(--muted-foreground)]/10' : ''}`}
                  >
                    <img src={icons.agents} alt={name} className="w-5 h-5" />
                    <span className="text-sm font-medium">{name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        vscode.postMessage({ type: 'spawnAgent', agentKey: name, isCustom: true })
                      }}
                      className={`w-6 text-center text-base font-semibold tabular-nums transition-colors ${isSelected ? '' : 'text-[var(--foreground)]'} hover:text-[var(--primary)]`}
                    >
                      <span className="group-hover:hidden">{count}</span>
                      <span className="hidden group-hover:inline">+</span>
                    </button>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Agent Terminals (shown when an agent is clicked) */}
          {selectedAgentType && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                  {getAgentDisplayName(selectedAgentType)} Agents
                </h2>
                <button
                  onClick={() => {
                    setSelectedAgentType(null)
                    setAgentTerminals([])
                  }}
                  className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                >
                  Close
                </button>
              </div>
              {agentTerminalsLoading ? (
                <div className="text-sm text-[var(--muted-foreground)] py-4">Loading...</div>
              ) : agentTerminals.length === 0 ? (
                <div className="text-sm text-[var(--muted-foreground)] py-4">
                  No terminals found for {getAgentDisplayName(selectedAgentType)}.
                </div>
              ) : (
                <div className="space-y-2">
                  {agentTerminals.map(terminal => {
                    const displayLabel = terminal.label || terminal.autoLabel
                    const agentName = getAgentDisplayName(terminal.agentType)
                    return (
                      <div key={terminal.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--muted)]">
                        <img
                          src={icons[terminal.agentType as keyof typeof icons] || icons.agents}
                          alt={terminal.agentType}
                          className="w-5 h-5"
                        />
                        <span className="text-sm font-medium">
                          {agentName} # {terminal.index}
                          {displayLabel && (
                            <span className="text-[var(--muted-foreground)]"> - {displayLabel}</span>
                          )}
                        </span>
                        <div className="flex-1" />
                        <span className="text-xs text-[var(--muted-foreground)]">
                          {formatTimeSince(terminal.createdAt)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}

          {/* Recent Swarms */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                Recent Swarms
              </h2>
              {tasks.length > 0 && (
                <button
                  onClick={() => setActiveTab('swarm')}
                  className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                >
                  View all
                </button>
              )}
            </div>
            {tasksLoading && tasks.length === 0 ? (
              <div className="text-sm text-[var(--muted-foreground)] py-4">Loading...</div>
            ) : tasks.length === 0 ? (
              <div className="text-sm text-[var(--muted-foreground)] py-4">
                No recent swarms. Use /swarm to spawn agents.
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.slice(0, 5).map(task => {
                  const agentTypes = getUniqueAgentTypes(task.agents)
                  return (
                    <div key={task.task_name} className="px-4 py-3 rounded-xl bg-[var(--muted)]">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium truncate">
                            {formatTaskName(task.task_name)}
                          </span>
                          <span className="text-xs text-[var(--muted-foreground)]">
                            {getTaskLatestTime(task) ? formatTimeAgo(getTaskLatestTime(task) as string) : '—'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs text-[var(--muted-foreground)]">
                            {/* Reserved for future context; keep layout balanced */}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {agentTypes.map(type => (
                              <img
                                key={type}
                                src={icons[type as keyof typeof icons] || icons.agents}
                                alt={type}
                                className="w-4 h-4"
                                title={type}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Shortcuts */}
          <section>
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)] mb-4">
              Shortcuts
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              {[
                ['Cmd+Shift+A', 'New agent'],
                ['Cmd+Shift+L', 'Label agent'],
                ['Cmd+Shift+G', 'Commit & push'],
                ['Cmd+Shift+C', 'Clear & restart'],
                ['Cmd+R', 'Next agent'],
                ['Cmd+E', 'Previous agent'],
                ["Cmd+Shift+'", 'Prompts'],
              ].map(([keys, label]) => (
                <div key={keys} className="flex items-center gap-4">
                  <kbd className="px-2 py-1 rounded bg-[var(--muted)] border border-[var(--border)] text-[var(--foreground)] font-mono text-xs min-w-[120px] text-center">
                    {keys}
                  </kbd>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {activeTab === 'tasks' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
              Todo
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchTodoFiles}
              disabled={todoLoading}
            >
              Refresh
            </Button>
          </div>
          {renderTodoTab()}
        </div>
      )}

      {activeTab === 'sessions' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
              Sessions
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchSessions}
              disabled={sessionsLoading}
            >
              Refresh
            </Button>
          </div>
          {sessionsLoading && recentSessions.length === 0 ? (
            <div className="text-center py-8 text-[var(--muted-foreground)]">Loading sessions...</div>
          ) : (
            renderSessionsTab()
          )}
        </div>
      )}

      {activeTab === 'swarm' && (
        <div className="space-y-8">
          {/* Swarm Integration */}
          <section>
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)] mb-4">
              Swarm Integration
            </h2>
            <div className="space-y-2">
              {(['claude', 'codex', 'gemini'] as SwarmAgentType[]).map((agent) => {
                const status = swarmStatus.agents[agent];
                const icon = icons[agent];
                const label = SWARM_AGENT_LABELS[agent];
                const showInstall = status.cliAvailable && !(status.mcpEnabled && status.commandInstalled);
                const statusBadge = status.cliAvailable
                  ? status.installed
                    ? { text: 'Installed', tone: 'bg-green-500/20 text-green-400' }
                    : { text: 'Not installed', tone: 'bg-[var(--secondary)] text-[var(--muted-foreground)]' }
                  : { text: 'CLI not found', tone: 'bg-[var(--secondary)] text-[var(--muted-foreground)]' };

                return (
                  <div key={agent} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--muted)]">
                    <img src={icon} alt={label} className="w-5 h-5" />
                    <span className="text-sm font-medium w-20">{label}</span>
                    <div className="flex items-center gap-2 text-xs">
                      <span className={`px-2 py-0.5 rounded ${statusBadge.tone}`}>{statusBadge.text}</span>
                      {status.cliAvailable && (
                        <>
                          <span className={`px-2 py-0.5 rounded ${status.mcpEnabled ? 'bg-green-500/15 text-green-300' : 'bg-[var(--secondary)] text-[var(--muted-foreground)]'}`}>
                            MCP {status.mcpEnabled ? 'Enabled' : 'Missing'}
                          </span>
                          <span className={`px-2 py-0.5 rounded ${status.commandInstalled ? 'bg-green-500/15 text-green-300' : 'bg-[var(--secondary)] text-[var(--muted-foreground)]'}`}>
                            Command {status.commandInstalled ? 'Installed' : 'Missing'}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="flex-1" />
                    {showInstall && (
                      <Button
                        size="sm"
                        onClick={() => handleInstallSwarmAgent(agent)}
                        disabled={swarmInstalling}
                      >
                        {swarmInstalling ? (
                          <span className="flex items-center gap-1.5">
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            Installing...
                          </span>
                        ) : (
                          'Install'
                        )}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          {/* Tasks */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                Tasks
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchTasks}
                disabled={tasksLoading}
              >
                <RefreshCw className={`w-4 h-4 mr-1.5 ${tasksLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
            {renderTasksTab()}
            {/* Pagination */}
            {tasks.length > TASKS_PER_PAGE && (
              <div className="flex items-center justify-center gap-2 mt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setTasksPage(p => Math.max(1, p - 1))}
                  disabled={tasksPage === 1}
                >
                  Previous
                </Button>
                <span className="text-sm text-[var(--muted-foreground)]">
                  Page {tasksPage} of {Math.ceil(tasks.length / TASKS_PER_PAGE)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setTasksPage(p => Math.min(Math.ceil(tasks.length / TASKS_PER_PAGE), p + 1))}
                  disabled={tasksPage >= Math.ceil(tasks.length / TASKS_PER_PAGE)}
                >
                  Next
                </Button>
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === 'skills' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
              Skills
            </h2>
            <p className="text-xs text-[var(--muted-foreground)]">
              Install slash-commands per agent to use Swarm helpers.
            </p>
          </div>

          {!skillsStatus ? (
            <div className="text-sm text-[var(--muted-foreground)] px-4 py-3">
              Loading skills...
            </div>
          ) : (
            <div className="space-y-6">
              <div className="space-y-3">
                <h3 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                  Basic
                </h3>
                {basicSkills.map(skill => (
                  <div key={skill.name} className="px-4 py-3 rounded-xl bg-[var(--muted)]">
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="text-sm font-medium capitalize">{skill.name}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">{skill.description}</p>
                      </div>
                      <div className="flex-1" />
                      <div className="flex items-center gap-3">
                        {SKILL_AGENTS.map(agent => {
                          const status = skill.agents[agent.key]
                          const isInstalled = status?.installed
                          const isDisabled = !status?.cliAvailable
                          return (
                            <div key={agent.key} className="flex items-center gap-2">
                              <div
                                className={`h-9 w-9 rounded-lg bg-[var(--background)] flex items-center justify-center border border-[var(--border)] ${
                                  isInstalled ? '' : 'opacity-60'
                                }`}
                              >
                                <img
                                  src={agent.icon}
                                  alt={agent.name}
                                  className={`w-5 h-5 ${isInstalled ? '' : 'grayscale'}`}
                                />
                              </div>
                              {!isInstalled && (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={skillInstalling || isDisabled}
                                  onClick={() =>
                                    vscode.postMessage({
                                      type: 'installSkillCommand',
                                      skill: skill.name,
                                      agent: agent.key
                                    })
                                  }
                                >
                                  {skillInstalling ? (
                                    <span className="flex items-center gap-1.5">
                                      <RefreshCw className="w-4 h-4 animate-spin" />
                                      Installing
                                    </span>
                                  ) : (
                                    'Install'
                                  )}
                                </Button>
                              )}
                              {isInstalled && (
                                <span className="text-xs text-green-400">Installed</span>
                              )}
                              {!status?.cliAvailable && (
                                <span className="text-xs text-[var(--muted-foreground)]">
                                  CLI missing
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="space-y-3">
                <h3 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                  Swarm
                </h3>
                {swarmSkills.map(skill => (
                  <div key={skill.name} className="px-4 py-3 rounded-xl bg-[var(--muted)]">
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="text-sm font-medium capitalize">{skill.name}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">{skill.description}</p>
                      </div>
                      <div className="flex-1" />
                      <div className="flex items-center gap-3">
                        {SKILL_AGENTS.map(agent => {
                          const status = skill.agents[agent.key]
                          const isInstalled = status?.installed
                          const isDisabled = !status?.cliAvailable
                          return (
                            <div key={agent.key} className="flex items-center gap-2">
                              <div
                                className={`h-9 w-9 rounded-lg bg-[var(--background)] flex items-center justify-center border border-[var(--border)] ${
                                  isInstalled ? '' : 'opacity-60'
                                }`}
                              >
                                <img
                                  src={agent.icon}
                                  alt={agent.name}
                                  className={`w-5 h-5 ${isInstalled ? '' : 'grayscale'}`}
                                />
                              </div>
                              {!isInstalled && (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={skillInstalling || isDisabled}
                                  onClick={() =>
                                    vscode.postMessage({
                                      type: 'installSkillCommand',
                                      skill: skill.name,
                                      agent: agent.key
                                    })
                                  }
                                >
                                  {skillInstalling ? (
                                    <span className="flex items-center gap-1.5">
                                      <RefreshCw className="w-4 h-4 animate-spin" />
                                      Installing
                                    </span>
                                  ) : (
                                    'Install'
                                  )}
                                </Button>
                              )}
                              {isInstalled && (
                                <span className="text-xs text-green-400">Installed</span>
                              )}
                              {!status?.cliAvailable && (
                                <span className="text-xs text-[var(--muted-foreground)]">
                                  CLI missing
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="space-y-8">
          {/* Default Agent */}
          <section>
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)] mb-4">
              Default Agent
            </h2>
            <div className="px-4 py-3 rounded-xl bg-[var(--muted)]">
              <p className="text-xs text-[var(--muted-foreground)] mb-3">
                Pick the agent that should open when you press Cmd+Shift+A.
              </p>
              {BUILT_IN_AGENTS.filter(a => a.key !== 'shell' && isAgentInstalled(a.key)).length === 0 ? (
                <div className="text-sm text-[var(--muted-foreground)]">
                  Install an agent to set a default.
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {BUILT_IN_AGENTS
                    .filter(a => a.key !== 'shell' && isAgentInstalled(a.key))
                    .map(agent => {
                      const isSelected = (AGENT_TITLE_TO_KEY[defaultAgent] || 'claude') === agent.key
                      return (
                        <button
                          key={agent.key}
                          onClick={() => handleSetDefaultAgent(AGENT_KEY_TO_TITLE[agent.key] || 'CC')}
                          className={`flex min-w-0 items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
                            isSelected
                              ? 'border-[var(--primary)] bg-[var(--background)] ring-1 ring-[var(--primary)]'
                              : 'border-[var(--border)] bg-[var(--background)] hover:border-[var(--primary)]/60 hover:bg-[var(--muted)]'
                          }`}
                        >
                          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--muted)]">
                            <img src={agent.icon} alt={agent.name} className="w-5 h-5" />
                          </span>
                          <div className="flex-1">
                            <p className="text-sm font-medium">{agent.name}</p>
                            <p className="text-xs text-[var(--muted-foreground)]">Opens with Cmd+Shift+A</p>
                          </div>
                          <span
                            className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                              isSelected
                                ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]'
                                : 'border-[var(--border)] text-transparent'
                            }`}
                          >
                            <Check className="w-3 h-3" />
                          </span>
                        </button>
                      )
                    })}
                </div>
              )}
            </div>
          </section>

          {/* Session Warming */}
          <section>
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)] mb-4">
              Session Warming
            </h2>
            <div className="px-4 py-3 rounded-xl bg-[var(--muted)]">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-medium">Pre-warm Sessions</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Start agent sessions in background for instant availability
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={prewarmEnabled ? 'default' : 'outline'}
                  onClick={togglePrewarm}
                >
                  {prewarmEnabled ? 'Enabled' : 'Disabled'}
                </Button>
              </div>
              {prewarmEnabled && prewarmLoaded && prewarmPools.length > 0 && (
                <div className="mt-4 space-y-3">
                  <p className="text-xs font-medium text-[var(--muted-foreground)]">Warmed Sessions</p>
                  {prewarmPools.map(pool => (
                    <div key={pool.agentType} className="flex items-center gap-3 text-sm">
                      <img
                        src={icons[pool.agentType as keyof typeof icons]}
                        alt={pool.agentType}
                        className="w-4 h-4"
                      />
                      <span className="capitalize w-16">{pool.agentType}</span>
                      <span className="text-[var(--muted-foreground)]">
                        {pool.available} ready{pool.pending > 0 ? `, ${pool.pending} warming` : ''}
                      </span>
                      {pool.sessions.length > 0 && (
                        <span className="text-xs text-[var(--muted-foreground)] ml-auto font-mono">
                          {pool.sessions[0].sessionId.slice(0, 8)}...
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Built-in Agents */}
          <section>
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)] mb-4">
              Built-in Agents
            </h2>
            <div className="space-y-2">
              {BUILT_IN_AGENTS.filter(a => a.key !== 'shell').map(agent => {
                const config = settings.builtIn[agent.key as keyof AgentSettings['builtIn']]
                const installed = isAgentInstalled(agent.key)
                const installInfo = getInstallInfo(agent.key)
                const isSwarmAgent = ALL_SWARM_AGENTS.includes(agent.key as SwarmAgentType)
                const modelOptions = AGENT_MODELS[agent.key] || []
                const modelDisabled = modelOptions.length === 0

                return (
                  <div
                    key={agent.key}
                    className={`flex items-center gap-4 px-4 py-3 rounded-xl bg-[var(--muted)] ${!installed ? 'opacity-60' : ''}`}
                  >
                    <img src={agent.icon} alt={agent.name} className="w-5 h-5" />
                    <span className="text-sm font-medium w-20">{agent.name}</span>

                    {installed ? (
                      <>
                        {/* Swarm checkbox */}
                        {isSwarmAgent && (
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={isSwarmAgentEnabled(agent.key as SwarmAgentType)}
                              onCheckedChange={(checked) => toggleSwarmAgent(agent.key as SwarmAgentType, !!checked)}
                            />
                            <label className="text-sm text-[var(--muted-foreground)]">Swarm</label>
                          </div>
                        )}

                        {/* Startup checkbox */}
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={config.login}
                            onCheckedChange={(checked) => updateBuiltIn(agent.key as keyof AgentSettings['builtIn'], 'login', !!checked)}
                          />
                          <label className="text-sm text-[var(--muted-foreground)]">Startup</label>
                        </div>

                        {/* Instances */}
                        {config.login && (
                          <div className="flex items-center gap-2 ml-2">
                            <Input
                              type="number"
                              min={1}
                              max={10}
                              value={config.instances}
                              onChange={(e) => updateBuiltIn(agent.key as keyof AgentSettings['builtIn'], 'instances', Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                              className="w-14 text-center"
                            />
                          </div>
                        )}

                        <div className="flex items-center gap-2 ml-2">
                          <label className="text-sm text-[var(--muted-foreground)]">Model</label>
                          <select
                            value={config.defaultModel || ''}
                            onChange={(e) => updateBuiltInModel(agent.key as keyof AgentSettings['builtIn'], e.target.value)}
                            className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm"
                            disabled={modelDisabled}
                          >
                            <option value="">
                              {modelDisabled ? 'No models available' : 'Auto'}
                            </option>
                            {modelOptions.map(model => (
                              <option key={model} value={model}>{model}</option>
                            ))}
                          </select>
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="text-xs text-[var(--muted-foreground)]">Not installed</span>
                        <div className="flex-1" />
                        {installInfo?.command && (
                          <button
                            onClick={() => navigator.clipboard.writeText(installInfo.command!)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--primary)] text-[var(--primary-foreground)] rounded-lg hover:opacity-90 transition-opacity"
                            title={`Copy: ${installInfo.command}`}
                          >
                            <Download className="w-3.5 h-3.5" />
                            Copy Install
                          </button>
                        )}
                        {installInfo?.url && (
                          <a
                            href={installInfo.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--secondary)] text-[var(--foreground)] rounded-lg hover:opacity-90 transition-opacity"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Install
                          </a>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          {/* Command Aliases */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                Command Aliases
              </h2>
              {!isAddingAlias && (
                <Button size="sm" variant="ghost" onClick={handleAddAliasClick}>
                  Add Alias
                </Button>
              )}
            </div>
            <p className="text-xs text-[var(--muted-foreground)] mb-3">
              Create shortcuts with custom flags. Use via Command Palette: <code className="bg-[var(--background)] px-1 rounded">agents.alias.YourName</code>
            </p>
            <div className="space-y-2">
              {(settings.aliases || []).map((alias, index) => {
                const agentInfo = BUILT_IN_AGENTS.find(a => a.key === alias.agent)
                return (
                  <div key={index} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--muted)]">
                    <img src={agentInfo?.icon || icons.agents} alt={alias.agent} className="w-5 h-5" />
                    <span className="text-sm font-medium">{alias.name}</span>
                    <span className="text-xs text-[var(--muted-foreground)]">{agentInfo?.name || alias.agent}</span>
                    <code className="text-xs text-[var(--muted-foreground)] bg-[var(--background)] px-2 py-0.5 rounded flex-1 truncate">
                      {alias.flags}
                    </code>
                    <Button size="sm" variant="ghost" onClick={() => removeAlias(index)}>
                      Remove
                    </Button>
                  </div>
                )
              })}

              {isAddingAlias && (
                <div className="px-4 py-3 rounded-xl bg-[var(--muted)] space-y-3">
                  <div className="grid grid-cols-[1fr,1fr,2fr] gap-3">
                    <div>
                      <label className="text-xs text-[var(--muted-foreground)] mb-1 block">Name</label>
                      <Input
                        value={newAliasName}
                        onChange={(e) => handleAliasNameChange(e.target.value)}
                        placeholder="Fast"
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--muted-foreground)] mb-1 block">Agent</label>
                      <select
                        value={newAliasAgent}
                        onChange={(e) => setNewAliasAgent(e.target.value)}
                        className="w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm"
                      >
                        {BUILT_IN_AGENTS.filter(a => a.key !== 'shell').map(agent => (
                          <option key={agent.key} value={agent.key}>{agent.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-[var(--muted-foreground)] mb-1 block">Flags</label>
                      <Input
                        value={newAliasFlags}
                        onChange={(e) => setNewAliasFlags(e.target.value)}
                        placeholder="--model claude-haiku-4-5-20251001"
                        className="w-full"
                      />
                    </div>
                  </div>
                  {aliasError && <p className="text-xs text-red-400">{aliasError}</p>}
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={handleCancelAddAlias}>Cancel</Button>
                    <Button size="sm" onClick={handleSaveAlias}>Save</Button>
                  </div>
                </div>
              )}

              {(settings.aliases || []).length === 0 && !isAddingAlias && (
                <div className="text-sm text-[var(--muted-foreground)] px-4 py-3 rounded-xl bg-[var(--muted)]">
                  No aliases configured. Add one to create a quick command with preset flags.
                </div>
              )}
            </div>
          </section>

          {/* Display Preferences */}
          <section>
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)] mb-4">
              Display
            </h2>
            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--muted)] cursor-pointer">
                <Checkbox
                  checked={settings.display?.showFullAgentNames}
                  onCheckedChange={(checked) => updateDisplay('showFullAgentNames', !!checked)}
                />
                <div>
                  <p className="text-sm font-medium">Show full agent names</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Use names like "Cursor" and "Gemini" instead of "CR" or "GX" in terminal tab titles.
                  </p>
                </div>
              </label>

              <label className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--muted)] cursor-pointer">
                <Checkbox
                  checked={!settings.display?.showLabelsInTitles}
                  onCheckedChange={(checked) => updateDisplay('showLabelsInTitles', !checked)}
                />
                <div>
                  <p className="text-sm font-medium">Disable labels in titles</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Keep labels in the status bar only. When unchecked, labels appear in the tab title (default).
                  </p>
                </div>
              </label>
            </div>
          </section>

          {/* Notifications */}
          <section>
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)] mb-4">
              Notifications
            </h2>
            <div className="space-y-3">
              <label className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--muted)] cursor-pointer">
                <Checkbox
                  checked={(settings.notifications ?? DEFAULT_NOTIFICATION_SETTINGS).enabled}
                  onCheckedChange={(checked) => updateNotifications({ enabled: !!checked })}
                />
                <div>
                  <p className="text-sm font-medium">Approval notifications</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Show notifications when an agent needs approval.
                  </p>
                </div>
              </label>

              <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--muted)]">
                <div className="flex-1">
                  <p className="text-sm font-medium">Notification style</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Native notifications require the Notifications MCP server.
                  </p>
                </div>
                <select
                  value={(settings.notifications ?? DEFAULT_NOTIFICATION_SETTINGS).style}
                  onChange={(e) => updateNotifications({ style: e.target.value as NotificationSettings['style'] })}
                  className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm"
                >
                  <option value="native">Native OS</option>
                  <option value="vscode">VS Code</option>
                </select>
              </div>

              <div className="px-4 py-3 rounded-xl bg-[var(--muted)] space-y-2">
                <div>
                  <p className="text-sm font-medium">Notify agents</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Currently supported: Claude Code CLI.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  {NOTIFICATION_AGENTS.map(agent => {
                    const current = settings.notifications ?? DEFAULT_NOTIFICATION_SETTINGS
                    const enabled = current.enabledAgents.includes(agent.key)
                    return (
                      <label
                        key={agent.key}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                          agent.supported
                            ? 'border-[var(--border)] bg-[var(--background)]'
                            : 'border-[var(--border)] bg-[var(--background)] opacity-60'
                        }`}
                      >
                        <Checkbox
                          checked={enabled}
                          disabled={!agent.supported}
                          onCheckedChange={(checked) => {
                            if (!agent.supported) return
                            const nextAgents = checked
                              ? [...current.enabledAgents, agent.key].filter((v, i, a) => a.indexOf(v) === i)
                              : current.enabledAgents.filter(a => a !== agent.key)
                            updateNotifications({ enabledAgents: nextAgents })
                          }}
                        />
                        <span>{agent.name}</span>
                        {!agent.supported && (
                          <span className="text-xs text-[var(--muted-foreground)]">Not supported</span>
                        )}
                      </label>
                    )
                  })}
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {activeTab === 'guide' && (
        <div className="space-y-6">
          <section>
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)] mb-4">
              Quick Start
            </h2>
            <div className="space-y-3">
              <div className="px-4 py-3 rounded-xl bg-[var(--muted)]">
                <div className="flex items-start gap-3">
                  <span className="text-sm font-semibold text-[var(--primary)]">1</span>
                  <div>
                    <p className="text-sm font-medium">Open an agent terminal</p>
                    <p className="text-xs text-[var(--muted-foreground)] mt-1">
                      Press Cmd+Shift+A and select an agent (Claude, Codex, Gemini, etc.)
                    </p>
                  </div>
                </div>
              </div>
              <div className="px-4 py-3 rounded-xl bg-[var(--muted)]">
                <div className="flex items-start gap-3">
                  <span className="text-sm font-semibold text-[var(--primary)]">2</span>
                  <div>
                    <p className="text-sm font-medium">Start coding with AI</p>
                    <p className="text-xs text-[var(--muted-foreground)] mt-1">
                      Type your request in the terminal. The agent will help you write, debug, and refactor code.
                    </p>
                  </div>
                </div>
              </div>
              <div className="px-4 py-3 rounded-xl bg-[var(--muted)]">
                <div className="flex items-start gap-3">
                  <span className="text-sm font-semibold text-[var(--primary)]">3</span>
                  <div>
                    <p className="text-sm font-medium">Try multiple agents</p>
                    <p className="text-xs text-[var(--muted-foreground)] mt-1">
                      Press Cmd+Shift+P and type "Agents: New Codex" to open another agent. If Codex isn't installed, run <span className="font-mono bg-[var(--background)] px-1 rounded">npm i -g @openai/codex</span> first.
                    </p>
                    <p className="text-xs text-[var(--muted-foreground)] mt-2">
                      Navigate between agents with Cmd+R (next) and Cmd+E (previous). If these conflict with other shortcuts, customize them in VS Code's Keyboard Shortcuts for "Next Agent" and "Previous Agent".
                    </p>
                  </div>
                </div>
              </div>
              <div className="px-4 py-3 rounded-xl bg-[var(--muted)]">
                <div className="flex items-start gap-3">
                  <span className="text-sm font-semibold text-[var(--primary)]">4</span>
                  <div>
                    <p className="text-sm font-medium">Use Swarm for parallel work</p>
                    <p className="text-xs text-[var(--muted-foreground)] mt-1">
                      Type /swarm in Claude to spawn multiple agents working on subtasks simultaneously.
                    </p>
                  </div>
                </div>
              </div>
              <div className="px-4 py-3 rounded-xl bg-[var(--muted)]">
                <div className="flex items-start gap-3">
                  <span className="text-sm font-semibold text-[var(--primary)]">5</span>
                  <div>
                    <p className="text-sm font-medium">Save reusable prompts</p>
                    <p className="text-xs text-[var(--muted-foreground)] mt-1">
                      Press Cmd+Shift+' to access your prompt library from any agent terminal.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)] mb-4">
              Learn More
            </h2>
            <div className="space-y-2">
              <button
                onClick={() => vscode.postMessage({ type: 'openGuide', guide: 'getting-started' })}
                className="w-full px-4 py-3 rounded-xl bg-[var(--muted)] text-left hover:bg-[var(--muted-foreground)]/10 transition-colors"
              >
                <p className="text-sm font-medium">Getting Started Guide</p>
                <p className="text-xs text-[var(--muted-foreground)] mt-1">Complete walkthrough of all features</p>
              </button>
              <button
                onClick={() => vscode.postMessage({ type: 'openGuide', guide: 'swarm' })}
                className="w-full px-4 py-3 rounded-xl bg-[var(--muted)] text-left hover:bg-[var(--muted-foreground)]/10 transition-colors"
              >
                <p className="text-sm font-medium">Swarm Mode</p>
                <p className="text-xs text-[var(--muted-foreground)] mt-1">How to use multi-agent orchestration</p>
              </button>
              <a
                href="https://github.com/muqsitnawaz/swarmify"
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full px-4 py-3 rounded-xl bg-[var(--muted)] text-left hover:bg-[var(--muted-foreground)]/10 transition-colors"
              >
                <p className="text-sm font-medium">GitHub Repository</p>
                <p className="text-xs text-[var(--muted-foreground)] mt-1">Source code, issues, and discussions</p>
              </a>
            </div>
          </section>
        </div>
      )}

      {/* Footer */}
      <footer className="pt-6 mt-8 border-t border-[var(--border)]">
        <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
          <span>From Swarmify</span>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/muqsitnawaz/swarmify"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--foreground)] transition-colors"
            >
              GitHub
            </a>
            <button
              onClick={() => setActiveTab('guide')}
              className="hover:text-[var(--foreground)] transition-colors"
            >
              Docs
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}
