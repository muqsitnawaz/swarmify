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
import { DashboardTab } from './components/tabs/DashboardTab'
import { WorkspaceTab } from './components/tabs/WorkspaceTab'
import { SettingsTab } from './components/tabs/SettingsTab'
import { GuideTab } from './components/tabs/GuideTab'

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
  const [activeTab, setActiveTab] = useState<TabId>('dashboard')
  const [showGuide, setShowGuide] = useState(false)
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [tasksLoaded, setTasksLoaded] = useState(false)
  const [tasksDisplayCount, setTasksDisplayCount] = useState(10)
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
  const [secondaryAgent, setSecondaryAgent] = useState<string>('CX')
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
  const [userConfigExists, setUserConfigExists] = useState(false)

  // Context files state
  const [contextFiles, setContextFiles] = useState<ContextFile[]>([])
  const [contextLoading, setContextLoading] = useState(false)
  const [contextLoaded, setContextLoaded] = useState(false)
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set())

  // Workspace path, GitHub repo, and dismissed tasks
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [githubRepo, setGithubRepo] = useState<string | null>(null)
  const [dismissedTaskIds, setDismissedTaskIds] = useState<Set<string>>(new Set())

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
          if (message.workspacePath) setWorkspacePath(message.workspacePath)
          if (message.githubRepo) setGithubRepo(message.githubRepo)
          if (message.dismissedTaskIds) setDismissedTaskIds(new Set(message.dismissedTaskIds))
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
        case 'secondaryAgentData':
          setSecondaryAgent(message.secondaryAgent)
          break
        case 'swarmStatus':
          if (message.swarmStatus) setSwarmStatus(message.swarmStatus)
          break
        case 'skillsStatus':
          if (message.skillsStatus) setSkillsStatus(message.skillsStatus)
          break
        case 'statusUpdate':
          // Phase 2 of two-phase loading - heavy status data arrived
          if (message.swarmStatus) setSwarmStatus(message.swarmStatus)
          if (message.skillsStatus) setSkillsStatus(message.skillsStatus)
          if (message.githubRepo) setGithubRepo(message.githubRepo)
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
          setUserConfigExists(Boolean(message.userExists))
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
    vscode.postMessage({ type: 'getSecondaryAgent' })
    vscode.postMessage({ type: 'getPrewarmStatus' })
    vscode.postMessage({ type: 'getWorkspaceConfig' })

    return () => window.removeEventListener('message', handleMessage)
  }, [])

  // Tab-specific data loading
  useEffect(() => {
    if (activeTab === 'dashboard' && !tasksLoaded && !tasksLoading) {
      fetchTasks()
    }
    if (activeTab === 'workspace' && !todoLoaded && !todoLoading) {
      fetchTodoFiles()
    }
    if (activeTab === 'workspace' && !unifiedTasksLoaded && !unifiedTasksLoading) {
      fetchUnifiedTasks()
      detectTaskSources()
    }
    if (activeTab === 'workspace' && !contextLoaded && !contextLoading) {
      fetchContextFiles()
    }
  }, [activeTab, tasksLoaded, tasksLoading, todoLoaded, todoLoading, unifiedTasksLoaded, unifiedTasksLoading, contextLoaded, contextLoading])

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
    setTasksDisplayCount(10)
    vscode.postMessage({ type: 'fetchTasks' })
  }

  const handleLoadMoreTasks = () => {
    setTasksDisplayCount(prev => prev + 10)
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
    setActiveTab('dashboard')
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

  const handleSetSecondaryAgent = (agentTitle: string) => {
    setSecondaryAgent(agentTitle)
    vscode.postMessage({ type: 'setSecondaryAgent', agentTitle })
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

  const handleDismissTask = (taskId: string) => {
    setDismissedTaskIds(prev => {
      const next = new Set(prev)
      next.add(taskId)
      return next
    })
    vscode.postMessage({ type: 'dismissTask', taskId })
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
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <img src={icons.agents} alt="Agents" className="w-8 h-8" />
            <h1 className="text-lg font-semibold tracking-tight">Agents</h1>
          </div>
          <button
            onClick={() => setShowGuide(!showGuide)}
            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
              showGuide
                ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]'
            }`}
            title="Help & Guide"
          >
            ?
          </button>
        </div>
        <div className="flex gap-1">
          {(['dashboard', 'workspace', 'settings'] as TabId[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
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

      {/* Guide panel (shown when ? is clicked) */}
      {showGuide && (
        <div className="px-4 py-4 rounded-xl bg-[var(--muted)] border border-[var(--border)]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Quick Guide</h2>
            <button
              onClick={() => setShowGuide(false)}
              className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              Close
            </button>
          </div>
          <GuideTab />
        </div>
      )}

      {/* Tab content */}
      {activeTab === 'dashboard' && (
        <DashboardTab
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
          tasksDisplayCount={tasksDisplayCount}
          icons={icons}
          isLightTheme={isLightTheme}
          onAgentClick={handleAgentClick}
          onCloseAgentTerminals={() => { setSelectedAgentType(null); setAgentTerminals([]) }}
          onNavigateToSettings={() => setActiveTab('settings')}
          onRefreshTasks={fetchTasks}
          onLoadMoreTasks={handleLoadMoreTasks}
        />
      )}

      {activeTab === 'workspace' && (
        <WorkspaceTab
          todoFiles={todoFiles}
          unifiedTasks={unifiedTasks}
          todoLoading={todoLoading}
          unifiedTasksLoading={unifiedTasksLoading}
          expandedSources={expandedSources}
          availableSources={availableSources}
          settings={settings}
          defaultAgent={defaultAgent}
          contextFiles={contextFiles}
          contextLoading={contextLoading}
          collapsedDirs={collapsedDirs}
          workspaceConfig={workspaceConfig}
          workspaceConfigLoaded={workspaceConfigLoaded}
          workspaceConfigExists={workspaceConfigExists}
          workspacePath={workspacePath}
          githubRepo={githubRepo}
          dismissedTaskIds={dismissedTaskIds}
          icons={icons}
          isLightTheme={isLightTheme}
          onToggleSource={toggleSourceExpanded}
          onSpawnTodo={handleSpawnTodo}
          onRefreshTasks={() => { fetchTodoFiles(); fetchUnifiedTasks() }}
          onRefreshContext={() => { setContextLoaded(false); fetchContextFiles() }}
          onUpdateTaskSources={handleUpdateTaskSources}
          onToggleDir={toggleDirExpanded}
          onOpenFile={openContextFile}
          onInitWorkspaceConfig={handleInitWorkspaceConfig}
          onSaveWorkspaceConfig={handleSaveWorkspaceConfig}
          onDismissTask={handleDismissTask}
        />
      )}

      {activeTab === 'settings' && (
        <SettingsTab
          settings={settings}
          swarmStatus={swarmStatus}
          skillsStatus={skillsStatus}
          builtInAgents={BUILT_IN_AGENTS}
          defaultAgent={defaultAgent}
          secondaryAgent={secondaryAgent}
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
          userConfigExists={userConfigExists}
          availableSources={availableSources}
          isAddingAlias={isAddingAlias}
          newAliasName={newAliasName}
          newAliasAgent={newAliasAgent}
          newAliasFlags={newAliasFlags}
          aliasError={aliasError}
          onSaveSettings={saveSettings}
          onInstallSwarmAgent={handleInstallSwarmAgent}
          onInstallCommandPack={handleInstallCommandPack}
          onSetDefaultAgent={handleSetDefaultAgent}
          onSetSecondaryAgent={handleSetSecondaryAgent}
          onTogglePrewarm={togglePrewarm}
          onUpdateTaskSources={handleUpdateTaskSources}
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
              onClick={() => setShowGuide(true)}
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
