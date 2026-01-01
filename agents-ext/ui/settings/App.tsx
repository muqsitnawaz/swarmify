import { useState, useEffect } from 'react'
import { Button } from './components/ui/button'
import { Checkbox } from './components/ui/checkbox'
import { Input } from './components/ui/input'
import { Trash2, Plus, X, Star, ChevronDown, ChevronRight, FileEdit, FilePlus, Terminal, MessageSquare, Clock, RefreshCw } from 'lucide-react'

interface BuiltInAgentSettings {
  login: boolean
  instances: number
}

interface CustomAgentSettings {
  name: string
  command: string
  login: boolean
  instances: number
}

type SwarmAgentType = 'cursor' | 'codex' | 'claude' | 'gemini' | 'opencode'
const ALL_SWARM_AGENTS: SwarmAgentType[] = ['cursor', 'codex', 'claude', 'gemini', 'opencode']

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
  swarmEnabledAgents: SwarmAgentType[]
  prompts: PromptEntry[]
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

interface SwarmStatus {
  mcpEnabled: boolean
  commandInstalled: boolean
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

type TabId = 'overview' | 'swarm' | 'prompts' | 'guide'

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
  cursor: 'Cursor',
  codex: 'Codex',
  claude: 'Claude',
  gemini: 'Gemini',
  opencode: 'OpenCode'
}

export default function App() {
  const [settings, setSettings] = useState<AgentSettings | null>(null)
  const [runningCounts, setRunningCounts] = useState<RunningCounts>({
    claude: 0, codex: 0, gemini: 0, opencode: 0, cursor: 0, shell: 0, custom: {}
  })
  const [swarmStatus, setSwarmStatus] = useState<SwarmStatus>({
    mcpEnabled: false, commandInstalled: false
  })
  const [isAdding, setIsAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCommand, setNewCommand] = useState('')
  const [nameError, setNameError] = useState('')

  // Prompt Stash state
  const [isAddingPrompt, setIsAddingPrompt] = useState(false)
  const [newPromptTitle, setNewPromptTitle] = useState('')
  const [newPromptContent, setNewPromptContent] = useState('')
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null)
  const [editPromptTitle, setEditPromptTitle] = useState('')
  const [editPromptContent, setEditPromptContent] = useState('')

  // Tab and Tasks state
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [tasksLoaded, setTasksLoaded] = useState(false)
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set())
  const [tasksPage, setTasksPage] = useState(1)
  const TASKS_PER_PAGE = 10

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data
      if (message.type === 'init') {
        setSettings(message.settings)
        setRunningCounts(message.runningCounts)
        if (message.swarmStatus) {
          setSwarmStatus(message.swarmStatus)
        }
      } else if (message.type === 'updateRunningCounts') {
        setRunningCounts(message.counts)
      } else if (message.type === 'tasksData') {
        setTasks(message.tasks || [])
        setTasksLoading(false)
        setTasksLoaded(true)
      }
    }

    window.addEventListener('message', handleMessage)
    vscode.postMessage({ type: 'ready' })

    return () => window.removeEventListener('message', handleMessage)
  }, [])

  // Fetch tasks when switching to swarm tab (only if not already loaded)
  useEffect(() => {
    if ((activeTab === 'swarm' || activeTab === 'overview') && !tasksLoaded && !tasksLoading) {
      fetchTasks()
    }
  }, [activeTab, tasksLoaded, tasksLoading])

  const fetchTasks = () => {
    setTasksLoading(true)
    vscode.postMessage({ type: 'fetchTasks' })
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

    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    return `${diffDays}d ago`
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

  // Get common directory from agents (use first agent's cwd, shortened)
  const getTaskDirectory = (agents: AgentDetail[]): string | null => {
    const firstCwd = agents.find(a => a.cwd)?.cwd
    if (!firstCwd) return null
    // Shorten home directory
    const home = firstCwd.match(/^\/Users\/[^/]+/)
    if (home) {
      return firstCwd.replace(home[0], '~')
    }
    return firstCwd
  }

  const handleEnableSwarm = () => {
    vscode.postMessage({ type: 'enableSwarm' })
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

  const updateCustom = (index: number, field: 'login' | 'instances', value: boolean | number) => {
    if (!settings) return
    const newCustom = [...settings.custom]
    newCustom[index] = { ...newCustom[index], [field]: value }
    saveSettings({ ...settings, custom: newCustom })
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

  // Prompts handlers
  const getPrompts = (): PromptEntry[] => {
    return settings?.prompts || []
  }

  const generateId = (): string => {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  }

  const handleAddPrompt = () => {
    if (!settings || !newPromptTitle.trim() || !newPromptContent.trim()) return

    const now = Date.now()
    const newEntry: PromptEntry = {
      id: generateId(),
      title: newPromptTitle.trim(),
      content: newPromptContent.trim(),
      isFavorite: false,
      createdAt: now,
      updatedAt: now,
      accessedAt: now
    }

    const newPrompts = [...getPrompts(), newEntry]
    saveSettings({ ...settings, prompts: newPrompts })
    setIsAddingPrompt(false)
    setNewPromptTitle('')
    setNewPromptContent('')
  }

  const handleDeletePrompt = (id: string) => {
    if (!settings) return
    const newPrompts = getPrompts().filter(p => p.id !== id)
    saveSettings({ ...settings, prompts: newPrompts })
  }

  const handleToggleFavorite = (id: string) => {
    if (!settings) return
    const newPrompts = getPrompts().map(p =>
      p.id === id ? { ...p, isFavorite: !p.isFavorite, updatedAt: Date.now() } : p
    )
    saveSettings({ ...settings, prompts: newPrompts })
  }

  const handleStartEdit = (entry: PromptEntry) => {
    setEditingPromptId(entry.id)
    setEditPromptTitle(entry.title)
    setEditPromptContent(entry.content)
  }

  const handleSaveEdit = () => {
    if (!settings || !editingPromptId || !editPromptTitle.trim() || !editPromptContent.trim()) return

    const newPrompts = getPrompts().map(p =>
      p.id === editingPromptId
        ? { ...p, title: editPromptTitle.trim(), content: editPromptContent.trim(), updatedAt: Date.now() }
        : p
    )
    saveSettings({ ...settings, prompts: newPrompts })
    setEditingPromptId(null)
    setEditPromptTitle('')
    setEditPromptContent('')
  }

  const handleCancelEdit = () => {
    setEditingPromptId(null)
    setEditPromptTitle('')
    setEditPromptContent('')
  }

  // Sort prompts: favorites first, then by accessedAt (most recently used first)
  const sortedPrompts = [...getPrompts()].sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1
    return b.accessedAt - a.accessedAt
  })

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
            const directory = getTaskDirectory(task.agents)
            return (
              <div key={task.task_name} className="rounded-xl bg-[var(--muted)] overflow-hidden">
                {/* Task header */}
                <button
                  onClick={() => toggleTaskExpanded(task.task_name)}
                  className="w-full px-4 py-3 hover:bg-[var(--muted-foreground)]/5 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    {isTaskExpanded ? (
                      <ChevronDown className="w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0" />
                    )}
                    <span className="text-sm font-medium truncate">{formatTaskName(task.task_name)}</span>
                    <div className="flex items-center gap-1">
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
                    <div className="flex-1" />
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {task.status_counts.running > 0 && (
                        <span className="px-1.5 py-0.5 text-xs rounded bg-blue-500/20 text-blue-400">
                          {task.status_counts.running} running
                        </span>
                      )}
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {task.agent_count} agent{task.agent_count !== 1 ? 's' : ''}
                      </span>
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {formatTimeAgo(task.latest_activity)}
                      </span>
                    </div>
                  </div>
                  {directory && (
                    <div className="text-xs text-[var(--muted-foreground)] mt-1 ml-7 font-mono truncate">
                      {directory}
                    </div>
                  )}
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
          {(['overview', 'swarm', 'prompts', 'guide'] as TabId[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors capitalize ${
                activeTab === tab
                  ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </header>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="space-y-8">
          {/* Running Now */}
          <section>
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)] mb-4">
              Running Now
            </h2>
            <div className="flex flex-wrap gap-3">
              {BUILT_IN_AGENTS.map(agent => (
                <div key={agent.key} className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-[var(--muted)]">
                  <img src={agent.icon} alt={agent.name} className="w-5 h-5" />
                  <span className="text-sm font-medium">{agent.name}</span>
                  <span className="text-base font-semibold text-[var(--foreground)] tabular-nums">
                    {runningCounts[agent.key as keyof typeof runningCounts] as number}
                  </span>
                </div>
              ))}
              {Object.entries(runningCounts.custom).map(([name, count]) => (
                <div key={name} className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-[var(--muted)]">
                  <img src={icons.agents} alt={name} className="w-5 h-5" />
                  <span className="text-sm font-medium">{name}</span>
                  <span className="text-base font-semibold text-[var(--foreground)] tabular-nums">{count}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Recent Tasks */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                Recent Tasks
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
                No recent tasks. Use /swarm to spawn agents.
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.slice(0, 5).map(task => {
                  const agentTypes = getUniqueAgentTypes(task.agents)
                  const directory = getTaskDirectory(task.agents)
                  return (
                    <div key={task.task_name} className="px-4 py-3 rounded-xl bg-[var(--muted)]">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium truncate">{formatTaskName(task.task_name)}</span>
                        <div className="flex items-center gap-1">
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
                        <div className="flex-1" />
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {task.status_counts.running > 0 && (
                            <span className="px-1.5 py-0.5 text-xs rounded bg-blue-500/20 text-blue-400">
                              {task.status_counts.running} running
                            </span>
                          )}
                          {task.status_counts.completed > 0 && (
                            <span className="px-1.5 py-0.5 text-xs rounded bg-green-500/20 text-green-400">
                              {task.status_counts.completed} done
                            </span>
                          )}
                          <span className="text-xs text-[var(--muted-foreground)]">
                            {task.agent_count} agent{task.agent_count !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                      {directory && (
                        <div className="text-xs text-[var(--muted-foreground)] mt-1 font-mono truncate">
                          {directory}
                        </div>
                      )}
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
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-4">
                <kbd className="px-2 py-1 rounded bg-[var(--muted)] border border-[var(--border)] text-[var(--foreground)] font-mono text-xs min-w-[120px] text-center">Cmd+Shift+A</kbd>
                <span>New agent</span>
              </div>
              <div className="flex items-center gap-4">
                <kbd className="px-2 py-1 rounded bg-[var(--muted)] border border-[var(--border)] text-[var(--foreground)] font-mono text-xs min-w-[120px] text-center">Cmd+Shift+L</kbd>
                <span>Label agent</span>
              </div>
              <div className="flex items-center gap-4">
                <kbd className="px-2 py-1 rounded bg-[var(--muted)] border border-[var(--border)] text-[var(--foreground)] font-mono text-xs min-w-[120px] text-center">Cmd+Shift+G</kbd>
                <span>Commit & push</span>
              </div>
              <div className="flex items-center gap-4">
                <kbd className="px-2 py-1 rounded bg-[var(--muted)] border border-[var(--border)] text-[var(--foreground)] font-mono text-xs min-w-[120px] text-center">Cmd+Shift+C</kbd>
                <span>Clear & restart</span>
              </div>
              <div className="flex items-center gap-4">
                <kbd className="px-2 py-1 rounded bg-[var(--muted)] border border-[var(--border)] text-[var(--foreground)] font-mono text-xs min-w-[120px] text-center">Cmd+R</kbd>
                <span>Next agent</span>
              </div>
              <div className="flex items-center gap-4">
                <kbd className="px-2 py-1 rounded bg-[var(--muted)] border border-[var(--border)] text-[var(--foreground)] font-mono text-xs min-w-[120px] text-center">Cmd+E</kbd>
                <span>Previous agent</span>
              </div>
              <div className="flex items-center gap-4">
                <kbd className="px-2 py-1 rounded bg-[var(--muted)] border border-[var(--border)] text-[var(--foreground)] font-mono text-xs min-w-[120px] text-center">Cmd+Shift+'</kbd>
                <span>Prompts</span>
              </div>
            </div>
          </section>
        </div>
      )}

      {activeTab === 'swarm' && (
        <div className="space-y-8">
          {/* Swarm Integration */}
          <section>
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)] mb-4">
              Integration
            </h2>
            <div className="px-4 py-3 rounded-xl bg-[var(--muted)] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">MCP Server</span>
                <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                  swarmStatus.mcpEnabled
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-[var(--secondary)] text-[var(--muted-foreground)]'
                }`}>
                  {swarmStatus.mcpEnabled ? 'Installed' : 'Not installed'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">/swarm Command</span>
                <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                  swarmStatus.commandInstalled
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-[var(--secondary)] text-[var(--muted-foreground)]'
                }`}>
                  {swarmStatus.commandInstalled ? 'Installed' : 'Not installed'}
                </span>
              </div>
              {(!swarmStatus.mcpEnabled || !swarmStatus.commandInstalled) && (
                <Button onClick={handleEnableSwarm} className="w-full mt-2">
                  Enable Swarm
                </Button>
              )}
            </div>
          </section>

          {/* Swarm Agents */}
          <section>
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)] mb-4">
              Agents
            </h2>
            <div className="flex flex-wrap gap-3">
              {(['cursor', 'codex', 'claude', 'gemini', 'opencode'] as SwarmAgentType[]).map(agent => (
                <div key={agent} className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-[var(--muted)]">
                  <Checkbox
                    checked={isSwarmAgentEnabled(agent)}
                    onCheckedChange={(checked) => toggleSwarmAgent(agent, !!checked)}
                  />
                  <span className="text-sm font-medium">{SWARM_AGENT_LABELS[agent]}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Open on Startup */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                Open on Startup
              </h2>
              {!isAdding ? (
                <Button variant="secondary" size="sm" onClick={handleAddClick}>
                  <Plus className="w-4 h-4 mr-1" />
                  Add
                </Button>
              ) : (
                <Button size="sm" onClick={handleSave}>
                  Save
                </Button>
              )}
            </div>
            <div className="space-y-2">
              {BUILT_IN_AGENTS.map(agent => {
                const config = settings.builtIn[agent.key as keyof AgentSettings['builtIn']]
                return (
                  <div key={agent.key} className="flex items-center gap-4 px-4 py-3 rounded-xl bg-[var(--muted)]">
                    <img src={agent.icon} alt={agent.name} className="w-5 h-5" />
                    <span className="text-sm font-medium w-20">{agent.name}</span>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={config.login}
                        onCheckedChange={(checked) => updateBuiltIn(agent.key as keyof AgentSettings['builtIn'], 'login', !!checked)}
                      />
                      <label className="text-sm text-[var(--muted-foreground)]">Open on Startup</label>
                    </div>
                    {config.login && (
                      <div className="flex items-center gap-2 ml-4">
                        <Input
                          type="number"
                          min={1}
                          max={10}
                          value={config.instances}
                          onChange={(e) => updateBuiltIn(agent.key as keyof AgentSettings['builtIn'], 'instances', Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                          className="w-14 text-center"
                        />
                        <span className="text-xs text-[var(--muted-foreground)]">
                          {config.instances === 1 ? 'instance' : 'instances'}
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
              {settings.custom.map((agent, index) => (
                <div key={index} className="flex items-center gap-4 px-4 py-3 rounded-xl bg-[var(--muted)]">
                  <img src={icons.agents} alt={agent.name} className="w-5 h-5" />
                  <span className="text-sm font-medium w-20">{agent.name}</span>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={agent.login}
                      onCheckedChange={(checked) => updateCustom(index, 'login', !!checked)}
                    />
                    <label className="text-sm text-[var(--muted-foreground)]">Open on Startup</label>
                  </div>
                  {agent.login && (
                    <div className="flex items-center gap-2 ml-4">
                      <Input
                        type="number"
                        min={1}
                        max={10}
                        value={agent.instances}
                        onChange={(e) => updateCustom(index, 'instances', Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                        className="w-14 text-center"
                      />
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {agent.instances === 1 ? 'instance' : 'instances'}
                      </span>
                    </div>
                  )}
                  <div className="flex-1" />
                  <Button variant="ghost" size="icon" onClick={() => removeCustomAgent(index)}>
                    <Trash2 className="w-4 h-4 text-[var(--muted-foreground)]" />
                  </Button>
                </div>
              ))}
              {isAdding && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[var(--muted)] border border-[var(--primary)]">
                  <img src={icons.agents} alt="New agent" className="w-5 h-5 opacity-50" />
                  <Input
                    placeholder="XX"
                    value={newName}
                    onChange={(e) => handleNameChange(e.target.value)}
                    className="w-16 uppercase text-center"
                    maxLength={2}
                    autoFocus
                  />
                  <Input
                    placeholder="command (e.g. my-agent-cli)"
                    value={newCommand}
                    onChange={(e) => setNewCommand(e.target.value)}
                    className="flex-1"
                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                  />
                  <Button variant="ghost" size="icon" onClick={handleCancelAdd}>
                    <X className="w-4 h-4 text-[var(--muted-foreground)]" />
                  </Button>
                </div>
              )}
              {isAdding && nameError && (
                <p className="text-xs text-red-400 ml-4">{nameError}</p>
              )}
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

      {activeTab === 'prompts' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
              Prompts
            </h2>
            {!isAddingPrompt && (
              <Button variant="secondary" size="sm" onClick={() => setIsAddingPrompt(true)}>
                <Plus className="w-4 h-4 mr-1" />
                Add
              </Button>
            )}
          </div>

          {isAddingPrompt && (
            <div className="px-4 py-3 rounded-xl bg-[var(--muted)] border border-[var(--primary)] space-y-3">
              <Input
                placeholder="Title"
                value={newPromptTitle}
                onChange={(e) => setNewPromptTitle(e.target.value)}
                autoFocus
              />
              <textarea
                placeholder="Prompt content..."
                value={newPromptContent}
                onChange={(e) => setNewPromptContent(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)] text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                rows={4}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => {
                  setIsAddingPrompt(false)
                  setNewPromptTitle('')
                  setNewPromptContent('')
                }}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleAddPrompt}>
                  Save
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {sortedPrompts.length === 0 && !isAddingPrompt && (
              <p className="text-sm text-[var(--muted-foreground)] px-4 py-3">
                No prompts saved. Use Cmd+Shift+' to access prompts from any agent terminal.
              </p>
            )}
            {sortedPrompts.map(entry => (
              <div key={entry.id} className="px-4 py-3 rounded-xl bg-[var(--muted)]">
                {editingPromptId === entry.id ? (
                  <div className="space-y-3">
                    <Input
                      value={editPromptTitle}
                      onChange={(e) => setEditPromptTitle(e.target.value)}
                      autoFocus
                    />
                    <textarea
                      value={editPromptContent}
                      onChange={(e) => setEditPromptContent(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)] text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                      rows={4}
                    />
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={handleSaveEdit}>
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleToggleFavorite(entry.id)}
                        className="text-[var(--muted-foreground)] hover:text-yellow-400 transition-colors"
                      >
                        <Star className={`w-4 h-4 ${entry.isFavorite ? 'fill-yellow-400 text-yellow-400' : ''}`} />
                      </button>
                      <span
                        className="text-sm font-medium flex-1 cursor-pointer hover:text-[var(--primary)]"
                        onClick={() => handleStartEdit(entry)}
                      >
                        {entry.title}
                      </span>
                      <Button variant="ghost" size="icon" onClick={() => handleDeletePrompt(entry.id)}>
                        <Trash2 className="w-4 h-4 text-[var(--muted-foreground)]" />
                      </Button>
                    </div>
                    <p
                      className="text-xs text-[var(--muted-foreground)] line-clamp-2 cursor-pointer hover:text-[var(--foreground)]"
                      onClick={() => handleStartEdit(entry)}
                    >
                      {entry.content}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
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
                    <p className="text-sm font-medium">Use Swarm for parallel work</p>
                    <p className="text-xs text-[var(--muted-foreground)] mt-1">
                      Type /swarm in Claude to spawn multiple agents working on subtasks simultaneously.
                    </p>
                  </div>
                </div>
              </div>
              <div className="px-4 py-3 rounded-xl bg-[var(--muted)]">
                <div className="flex items-start gap-3">
                  <span className="text-sm font-semibold text-[var(--primary)]">4</span>
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
