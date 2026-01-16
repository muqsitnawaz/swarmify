import React, { useState, useEffect } from 'react'
import { Button } from './components/ui/button'

// Import extracted modules
import {
  AgentSettings,
  SwarmStatus,
  SkillsStatus,
  TaskSummary,
  TodoFile,
  UnifiedTask,
  TaskSource,
  AgentSession,
  ContextFile,
  TerminalDetail,
  RunningCounts,
  TabId,
  IconConfig,
  PrewarmPool,
  WorkspaceConfig,
  SwarmAgentType,
  TodoItem,
} from './types'
import {
  ALL_SWARM_AGENTS,
  TAB_LABELS,
  SESSIONS_PER_PAGE,
  createBuiltInAgents,
} from './constants'
import { useSystemTheme, getVsCodeApi, getIcons, postMessage } from './hooks'
import { validateAliasName } from './utils'

// Tab components
import { GuideTab } from './components/tabs/GuideTab'
import { SessionsTab } from './components/tabs/SessionsTab'
import { TasksTab } from './components/tabs/TasksTab'
import { ContextTab } from './components/tabs/ContextTab'
import { OverviewTab } from './components/tabs/OverviewTab'
import { SettingsTab } from './components/tabs/SettingsTab'

const vscode = getVsCodeApi()
const icons = getIcons() as IconConfig
const BUILT_IN_AGENTS = createBuiltInAgents(icons)

export default function App() {
  const isLightTheme = useSystemTheme()

  // Core settings state
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

  // Skills and tab state
  const [skillsStatus, setSkillsStatus] = useState<SkillsStatus | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [tasksLoaded, setTasksLoaded] = useState(false)
  const [swarmInstalling, setSwarmInstalling] = useState(false)
  const [commandPackInstalling, setCommandPackInstalling] = useState(false)

  // Session tasks state
  const [sessionTasks, setSessionTasks] = useState<Record<string, TaskSummary[]>>({})
  const [sessionTasksLoading, setSessionTasksLoading] = useState<Record<string, boolean>>({})

  // Todo and unified tasks state
  const [todoFiles, setTodoFiles] = useState<TodoFile[]>([])
  const [todoLoading, setTodoLoading] = useState(false)
  const [todoLoaded, setTodoLoaded] = useState(false)
  const [unifiedTasks, setUnifiedTasks] = useState<UnifiedTask[]>([])
  const [unifiedTasksLoading, setUnifiedTasksLoading] = useState(false)
  const [unifiedTasksLoaded, setUnifiedTasksLoaded] = useState(false)
  const [availableSources, setAvailableSources] = useState<{ markdown: boolean; linear: boolean; github: boolean }>({
    markdown: true, linear: false, github: false
  })
  const [expandedSources, setExpandedSources] = useState<Set<TaskSource>>(new Set(['markdown']))

  // Sessions state
  const [recentSessions, setRecentSessions] = useState<AgentSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [sessionsPage, setSessionsPage] = useState(1)

  // Agent terminals state
  const [selectedAgentType, setSelectedAgentType] = useState<string | null>(null)
  const [agentTerminals, setAgentTerminals] = useState<TerminalDetail[]>([])
  const [agentTerminalsLoading, setAgentTerminalsLoading] = useState(false)

  // Default agent and installed agents
  const [defaultAgent, setDefaultAgent] = useState<string>('CC')
  const [installedAgents, setInstalledAgents] = useState<Record<string, boolean>>({
    claude: true, codex: true, gemini: true, opencode: true, cursor: true, shell: true
  })

  // Prewarm state
  const [prewarmEnabled, setPrewarmEnabled] = useState(false)
  const [prewarmPools, setPrewarmPools] = useState<PrewarmPool[]>([])
  const [prewarmLoaded, setPrewarmLoaded] = useState(false)

  // Workspace config state
  const [workspaceConfig, setWorkspaceConfig] = useState<WorkspaceConfig | null>(null)
  const [workspaceConfigExists, setWorkspaceConfigExists] = useState(false)
  const [workspaceConfigLoaded, setWorkspaceConfigLoaded] = useState(false)

  // Context files state
  const [contextFiles, setContextFiles] = useState<ContextFile[]>([])
  const [contextLoading, setContextLoading] = useState(false)
  const [contextLoaded, setContextLoaded] = useState(false)
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set())

  // Alias editing state
  const [isAddingAlias, setIsAddingAlias] = useState(false)
  const [newAliasName, setNewAliasName] = useState('')
  const [newAliasAgent, setNewAliasAgent] = useState('claude')
  const [newAliasFlags, setNewAliasFlags] = useState('')
  const [aliasError, setAliasError] = useState('')

  const hasCliInstalled = installedAgents.claude || installedAgents.codex || installedAgents.gemini
  const showIntegrationCallout = !hasCliInstalled && !swarmStatus.mcpEnabled

  // Message handler
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data
      switch (message.type) {
        case 'init':
          setSettings(message.settings)
          setRunningCounts(message.runningCounts)
          if (message.swarmStatus) setSwarmStatus(message.swarmStatus)
          if (message.skillsStatus) setSkillsStatus(message.skillsStatus)
          break
        case 'updateRunningCounts':
          setRunningCounts(message.counts)
          break
        case 'tasksData':
          setTasks(message.tasks || [])
          setTasksLoading(false)
          setTasksLoaded(true)
          break
        case 'todoFilesData':
        case 'todoFilesUpdated':
          setTodoFiles(message.files || [])
          setTodoLoading(false)
          setTodoLoaded(true)
          break
        case 'sessionsData':
        case 'sessionsUpdated':
          setRecentSessions(message.sessions || [])
          setSessionsLoading(false)
          setSessionsLoaded(true)
          break
        case 'agentTerminalsData':
          setAgentTerminals(message.terminals || [])
          setAgentTerminalsLoading(false)
          break
        case 'installedAgentsData':
          setInstalledAgents(message.installedAgents)
          break
        case 'defaultAgentData':
          setDefaultAgent(message.defaultAgent)
          break
        case 'swarmStatus':
          if (message.swarmStatus) setSwarmStatus(message.swarmStatus)
          break
        case 'skillsStatus':
          if (message.skillsStatus) setSkillsStatus(message.skillsStatus)
          break
        case 'swarmInstallStart':
          setSwarmInstalling(true)
          break
        case 'swarmInstallDone':
          setSwarmInstalling(false)
          break
        case 'commandPackInstallStart':
          setCommandPackInstalling(true)
          break
        case 'commandPackInstallDone':
          setCommandPackInstalling(false)
          break
        case 'prewarmStatus':
          setPrewarmEnabled(message.enabled)
          setPrewarmPools(message.pools || [])
          setPrewarmLoaded(true)
          break
        case 'workspaceConfigData':
          setWorkspaceConfig(message.config)
          setWorkspaceConfigExists(message.exists)
          setWorkspaceConfigLoaded(true)
          break
        case 'contextFilesData':
          setContextFiles(message.files || [])
          setContextLoading(false)
          setContextLoaded(true)
          break
        case 'unifiedTasksData':
          setUnifiedTasks(message.tasks || [])
          setUnifiedTasksLoading(false)
          setUnifiedTasksLoaded(true)
          break
        case 'taskSourcesData':
          setAvailableSources(message.sources || { markdown: true, linear: false, github: false })
          break
        case 'sessionTasksData':
          setSessionTasks(prev => ({ ...prev, [message.sessionId]: message.tasks || [] }))
          setSessionTasksLoading(prev => ({ ...prev, [message.sessionId]: false }))
          break
      }
    }

    window.addEventListener('message', handleMessage)
    vscode.postMessage({ type: 'ready' })
    vscode.postMessage({ type: 'checkInstalledAgents' })
    vscode.postMessage({ type: 'getDefaultAgent' })
    vscode.postMessage({ type: 'getPrewarmStatus' })
    vscode.postMessage({ type: 'getWorkspaceConfig' })

    return () => window.removeEventListener('message', handleMessage)
  }, [])

  // Tab-specific data loading
  useEffect(() => {
    if (activeTab === 'overview' && !tasksLoaded && !tasksLoading) {
      fetchTasks()
    }
    if (activeTab === 'tasks' && !todoLoaded && !todoLoading) {
      fetchTodoFiles()
    }
    if (activeTab === 'tasks' && !unifiedTasksLoaded && !unifiedTasksLoading) {
      fetchUnifiedTasks()
      detectTaskSources()
    }
  }, [activeTab, tasksLoaded, tasksLoading, todoLoaded, todoLoading, unifiedTasksLoaded, unifiedTasksLoading])

  useEffect(() => {
    if (activeTab === 'sessions' && !sessionsLoaded && !sessionsLoading) {
      fetchSessions()
    }
  }, [activeTab, sessionsLoaded, sessionsLoading])

  useEffect(() => {
    if (activeTab === 'context' && !contextLoaded && !contextLoading) {
      fetchContextFiles()
    }
  }, [activeTab, contextLoaded, contextLoading])

  useEffect(() => {
    if (!selectedAgentType || agentTerminals.length === 0) return
    for (const terminal of agentTerminals) {
      if (!terminal.sessionId) continue
      if (sessionTasks[terminal.sessionId]) continue
      if (sessionTasksLoading[terminal.sessionId]) continue
      fetchTasksBySession(terminal.sessionId)
    }
  }, [selectedAgentType, agentTerminals, sessionTasks, sessionTasksLoading])

  // Data fetching functions
  const fetchTasks = () => {
    setTasksLoading(true)
    vscode.postMessage({ type: 'fetchTasks' })
  }

  const fetchTodoFiles = () => {
    setTodoLoading(true)
    vscode.postMessage({ type: 'fetchTodoFiles' })
  }

  const fetchUnifiedTasks = () => {
    setUnifiedTasksLoading(true)
    vscode.postMessage({ type: 'fetchUnifiedTasks' })
  }

  const detectTaskSources = () => {
    vscode.postMessage({ type: 'detectTaskSources' })
  }

  const fetchSessions = () => {
    setSessionsLoading(true)
    setSessionsPage(1)
    vscode.postMessage({ type: 'fetchSessions', limit: 200 })
  }

  const fetchContextFiles = () => {
    setContextLoading(true)
    vscode.postMessage({ type: 'fetchContextFiles' })
  }

  const fetchTasksBySession = (sessionId: string) => {
    setSessionTasksLoading(prev => ({ ...prev, [sessionId]: true }))
    vscode.postMessage({ type: 'fetchTasksBySession', sessionId })
  }

  // Handler functions
  const toggleSourceExpanded = (source: TaskSource) => {
    setExpandedSources(prev => {
      const next = new Set(prev)
      if (next.has(source)) next.delete(source)
      else next.add(source)
      return next
    })
  }

  const handleAgentClick = (agentKey: string) => {
    if (selectedAgentType === agentKey) {
      setSelectedAgentType(null)
      setAgentTerminals([])
    } else {
      setSelectedAgentType(agentKey)
      setAgentTerminalsLoading(true)
      vscode.postMessage({ type: 'fetchAgentTerminals', agentType: agentKey })
    }
  }

  const handleSpawnTodo = (item: TodoItem, filePath: string) => {
    setActiveTab('overview')
    vscode.postMessage({ type: 'spawnSwarmForTodo', item, filePath })
  }

  const handleOpenSession = (session: AgentSession) => {
    vscode.postMessage({ type: 'openSession', session })
  }

  const saveSettings = (newSettings: AgentSettings) => {
    setSettings(newSettings)
    vscode.postMessage({ type: 'saveSettings', settings: newSettings })
  }

  const handleInstallSwarmAgent = (agent: SwarmAgentType) => {
    setSwarmInstalling(true)
    vscode.postMessage({ type: 'installSwarmAgent', agent })
  }

  const handleInstallCommandPack = () => {
    setCommandPackInstalling(true)
    vscode.postMessage({ type: 'installCommandPack' })
  }

  const handleSetDefaultAgent = (agentTitle: string) => {
    setDefaultAgent(agentTitle)
    vscode.postMessage({ type: 'setDefaultAgent', agentTitle })
  }

  const togglePrewarm = () => {
    vscode.postMessage({ type: 'togglePrewarm' })
  }

  const toggleDirExpanded = (dir: string) => {
    setCollapsedDirs(prev => {
      const next = new Set(prev)
      if (next.has(dir)) next.delete(dir)
      else next.add(dir)
      return next
    })
  }

  const openContextFile = (filePath: string) => {
    vscode.postMessage({ type: 'openContextFile', path: filePath })
  }

  const handleUpdateTaskSources = (updates: Partial<AgentSettings['taskSources']>) => {
    if (!settings) return
    const newSettings = {
      ...settings,
      taskSources: { ...settings.taskSources, ...updates }
    }
    saveSettings(newSettings)
    if (updates.linear || updates.github) fetchUnifiedTasks()
  }

  // Alias handlers
  const handleAliasNameChange = (value: string) => {
    setNewAliasName(value)
    setAliasError(validateAliasName(value, settings?.aliases || []))
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
    const error = validateAliasName(newAliasName, settings?.aliases || [])
    if (error) {
      setAliasError(error)
      return
    }
    if (!newAliasFlags.trim()) {
      setAliasError('Flags required')
      return
    }
    if (!settings) return
    const aliases = settings.aliases || []
    saveSettings({
      ...settings,
      aliases: [...aliases, { name: newAliasName.trim(), agent: newAliasAgent, flags: newAliasFlags.trim() }]
    })
    handleCancelAddAlias()
  }

  const handleRemoveAlias = (index: number) => {
    if (!settings) return
    const aliases = settings.aliases || []
    saveSettings({ ...settings, aliases: aliases.filter((_, i) => i !== index) })
  }

  // Workspace config handlers
  const handleInitWorkspaceConfig = () => {
    vscode.postMessage({ type: 'initWorkspaceConfig' })
  }

  const handleSaveWorkspaceConfig = (config: WorkspaceConfig) => {
    setWorkspaceConfig(config)
    vscode.postMessage({ type: 'saveWorkspaceConfig', config })
  }

  if (!settings) {
    return <div className="text-[var(--muted-foreground)]">Loading...</div>
  }

  return (
    <div className="space-y-6">
      {/* Header with tabs */}
      <header className="pb-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-3 mb-4">
          <img src={icons.agents} alt="Agents" className="w-8 h-8" />
          <h1 className="text-lg font-semibold tracking-tight">Agents</h1>
        </div>
        <div className="flex gap-1">
          {(['overview', 'tasks', 'sessions', 'context', 'settings', 'guide'] as TabId[]).map(tab => (
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
        <OverviewTab
          showIntegrationCallout={showIntegrationCallout}
          runningCounts={runningCounts}
          builtInAgents={BUILT_IN_AGENTS}
          selectedAgentType={selectedAgentType}
          agentTerminals={agentTerminals}
          agentTerminalsLoading={agentTerminalsLoading}
          sessionTasks={sessionTasks}
          sessionTasksLoading={sessionTasksLoading}
          tasks={tasks}
          tasksLoading={tasksLoading}
          icons={icons}
          isLightTheme={isLightTheme}
          onAgentClick={handleAgentClick}
          onCloseAgentTerminals={() => { setSelectedAgentType(null); setAgentTerminals([]) }}
          onNavigateToSettings={() => setActiveTab('settings')}
          onRefreshTasks={fetchTasks}
        />
      )}

      {activeTab === 'tasks' && (
        <TasksTab
          todoFiles={todoFiles}
          unifiedTasks={unifiedTasks}
          todoLoading={todoLoading}
          unifiedTasksLoading={unifiedTasksLoading}
          expandedSources={expandedSources}
          availableSources={availableSources}
          settings={settings}
          onToggleSource={toggleSourceExpanded}
          onSpawnTodo={handleSpawnTodo}
          onRefresh={() => { fetchTodoFiles(); fetchUnifiedTasks() }}
          onUpdateTaskSources={handleUpdateTaskSources}
        />
      )}

      {activeTab === 'sessions' && (
        <SessionsTab
          sessions={recentSessions}
          loading={sessionsLoading}
          page={sessionsPage}
          onPageChange={setSessionsPage}
          onOpenSession={handleOpenSession}
          onRefresh={fetchSessions}
        />
      )}

      {activeTab === 'context' && (
        <ContextTab
          contextFiles={contextFiles}
          loading={contextLoading}
          collapsedDirs={collapsedDirs}
          icons={icons}
          isLightTheme={isLightTheme}
          onRefresh={() => { setContextLoaded(false); fetchContextFiles() }}
          onToggleDir={toggleDirExpanded}
          onOpenFile={openContextFile}
        />
      )}

      {activeTab === 'settings' && (
        <SettingsTab
          settings={settings}
          swarmStatus={swarmStatus}
          skillsStatus={skillsStatus}
          builtInAgents={BUILT_IN_AGENTS}
          defaultAgent={defaultAgent}
          installedAgents={installedAgents}
          icons={icons}
          isLightTheme={isLightTheme}
          swarmInstalling={swarmInstalling}
          commandPackInstalling={commandPackInstalling}
          prewarmEnabled={prewarmEnabled}
          prewarmLoaded={prewarmLoaded}
          prewarmPools={prewarmPools}
          workspaceConfig={workspaceConfig}
          workspaceConfigLoaded={workspaceConfigLoaded}
          workspaceConfigExists={workspaceConfigExists}
          isAddingAlias={isAddingAlias}
          newAliasName={newAliasName}
          newAliasAgent={newAliasAgent}
          newAliasFlags={newAliasFlags}
          aliasError={aliasError}
          onSaveSettings={saveSettings}
          onInstallSwarmAgent={handleInstallSwarmAgent}
          onInstallCommandPack={handleInstallCommandPack}
          onSetDefaultAgent={handleSetDefaultAgent}
          onTogglePrewarm={togglePrewarm}
          onAddAliasClick={handleAddAliasClick}
          onCancelAddAlias={handleCancelAddAlias}
          onSaveAlias={handleSaveAlias}
          onRemoveAlias={handleRemoveAlias}
          onAliasNameChange={handleAliasNameChange}
          onAliasAgentChange={setNewAliasAgent}
          onAliasFlagsChange={setNewAliasFlags}
          onInitWorkspaceConfig={handleInitWorkspaceConfig}
          onSaveWorkspaceConfig={handleSaveWorkspaceConfig}
        />
      )}

      {activeTab === 'guide' && <GuideTab />}

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
