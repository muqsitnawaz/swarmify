import React, { useState, useEffect } from 'react'
import { Button } from './components/ui/button'

// Import extracted modules
import {
  AgentSettings,
  SwarmStatus,
  SkillsStatus,
  TaskSummary,
  UnifiedTask,
  CycleInfo,
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
} from './types'
import {
  ALL_SWARM_AGENTS,
  TAB_LABELS,
  SESSIONS_PER_PAGE,
  createBuiltInAgents,
} from './constants'
import { useSystemTheme, getVsCodeApi, getIcons, postMessage } from './hooks'
import { validateAliasName } from './utils'

// New layout shell
import { TopBar, StatusBar, MissionControlTab, CommandPalette } from './components/mission-control'
import type { TabKey } from './components/mission-control'

// Tab components (legacy, for Bench and Panel)
import { BenchTab } from './components/bench'
import { PanelTab } from './components/panel'
import { GuideTab } from './components/tabs/GuideTab'
import { ApiKeyDialog } from './components/common/OAuthDialog'
import { ForemanOrb, ForemanCursor } from './components/foreman'

const vscode = getVsCodeApi()
const icons = getIcons() as IconConfig
const BUILT_IN_AGENTS = createBuiltInAgents(icons)

function getAgentWithHighestRunningCount(runningCounts: RunningCounts): string | null {
  const candidates: Array<[string, number]> = [
    ['claude', runningCounts.claude],
    ['codex', runningCounts.codex],
    ['gemini', runningCounts.gemini],
    ['opencode', runningCounts.opencode],
    ['cursor', runningCounts.cursor],
    ['shell', runningCounts.shell],
    ...Object.entries(runningCounts.custom),
  ]

  let best: string | null = null
  let bestCount = 0
  for (const [agentKey, count] of candidates) {
    if (count > bestCount) {
      best = agentKey
      bestCount = count
    }
  }
  return bestCount > 0 ? best : null
}

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
  const [activeTab, setActiveTab] = useState<TabKey>('floor')
  const [cmdKOpen, setCmdKOpen] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [openDispatchTrigger, setOpenDispatchTrigger] = useState(0)
  const [openDetailTaskId, setOpenDetailTaskId] = useState<string | null>(null)
  const [floorThroughput, setFloorThroughput] = useState(0)
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [tasksLoaded, setTasksLoaded] = useState(false)
  const [tasksDisplayCount, setTasksDisplayCount] = useState(10)
  const [swarmInstalling, setSwarmInstalling] = useState(false)
  const [commandPackInstalling, setCommandPackInstalling] = useState(false)

  // Session tasks state
  const [sessionTasks, setSessionTasks] = useState<Record<string, TaskSummary[]>>({})
  const [sessionTasksLoading, setSessionTasksLoading] = useState<Record<string, boolean>>({})

  // Unified tasks state
  const [unifiedTasks, setUnifiedTasks] = useState<UnifiedTask[]>([])
  const [unifiedTasksLoading, setUnifiedTasksLoading] = useState(false)
  const [unifiedTasksLoaded, setUnifiedTasksLoaded] = useState(false)
  const [cycleInfo, setCycleInfo] = useState<CycleInfo | null>(null)
  const [availableSources, setAvailableSources] = useState<{ linear: boolean; github: boolean }>({
    linear: false, github: false
  })
  const [expandedSources, setExpandedSources] = useState<Set<TaskSource>>(new Set(['linear']))

  // Sessions state
  const [recentSessions, setRecentSessions] = useState<AgentSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [sessionsPage, setSessionsPage] = useState(1)

  // Agent terminals state
  const [selectedAgentType, setSelectedAgentType] = useState<string | null>(null)
  const [agentTerminals, setAgentTerminals] = useState<TerminalDetail[]>([])
  const [agentTerminalsLoading, setAgentTerminalsLoading] = useState(false)
  const [dashboardAutoSelected, setDashboardAutoSelected] = useState(false)

  // All terminals (for Floor tab)
  const [allTerminals, setAllTerminals] = useState<TerminalDetail[]>([])

  // Default agent and installed agents
  const [defaultAgent, setDefaultAgent] = useState<string>('CC')
  const [secondaryAgent, setSecondaryAgent] = useState<string>('CX')
  const [agentModels, setAgentModels] = useState<Record<string, string[]>>({})
  const [installedAgents, setInstalledAgents] = useState<Record<string, boolean>>({
    claude: true, codex: true, gemini: true, opencode: true, cursor: true, shell: true
  })

  // Prewarm state
  const [prewarmEnabled, setPrewarmEnabled] = useState(false)
  const [prewarmPools, setPrewarmPools] = useState<PrewarmPool[]>([])
  const [prewarmLoaded, setPrewarmLoaded] = useState(false)

  // Watchdog state
  const [watchdogEnabled, setWatchdogEnabled] = useState(false)

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

  // OAuth dialog state
  const [showLinearAuth, setShowLinearAuth] = useState(false)
  const [showGitHubAuth, setShowGitHubAuth] = useState(false)

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
        case 'openDispatchModal':
          setActiveTab('floor')
          setOpenDispatchTrigger((n) => n + 1)
          break
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
        case 'cloudSummaryUpdate': {
          // Live SSE update for one cloud agent — patch its cloud_summary
          // in-place so the detail pane streams without waiting for the
          // 10s fetchTasks cycle.
          const { executionId, summary, status } = message
          if (typeof executionId !== 'string') break
          setTasks((prev) => {
            let changed = false
            const next = prev.map((task) => {
              const idx = task.agents.findIndex((a) => a.agent_id === executionId)
              if (idx < 0) return task
              const agent = task.agents[idx]
              if (agent.cloud_summary === summary && agent.status === status) return task
              changed = true
              const newAgents = task.agents.slice()
              newAgents[idx] = {
                ...agent,
                cloud_summary: typeof summary === 'string' ? summary : agent.cloud_summary,
                status: typeof status === 'string' ? mapCloudStreamStatus(status, agent.status) : agent.status,
              }
              return { ...task, agents: newAgents }
            })
            return changed ? next : prev
          })
          break
        }
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
        case 'allTerminalsData':
          setAllTerminals(message.terminals || [])
          break
        case 'installedAgentsData':
          setInstalledAgents(message.installedAgents)
          break
        case 'agentModelsData':
          if (message.agentModels && typeof message.agentModels === 'object') {
            setAgentModels((prev) => ({ ...prev, ...message.agentModels }))
          }
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
        case 'watchdogStatus':
          setWatchdogEnabled(!!message.enabled)
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
          setCycleInfo(message.cycleInfo || null)
          setUnifiedTasksLoading(false)
          setUnifiedTasksLoaded(true)
          break
        case 'taskSourcesData':
          setAvailableSources(message.sources || { linear: false, github: false })
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
    vscode.postMessage({ type: 'fetchAgentModels' })
    vscode.postMessage({ type: 'getDefaultAgent' })
    vscode.postMessage({ type: 'getSecondaryAgent' })
    vscode.postMessage({ type: 'getWatchdogStatus' })
    vscode.postMessage({ type: 'getPrewarmStatus' })
    vscode.postMessage({ type: 'getWorkspaceConfig' })
    vscode.postMessage({ type: 'fetchAllTerminals' })
    vscode.postMessage({ type: 'detectTaskSources' })

    return () => window.removeEventListener('message', handleMessage)
  }, [])

  // Tab-specific data loading
  useEffect(() => {
    if (activeTab === 'floor' && !tasksLoaded && !tasksLoading) {
      fetchTasks()
    }
    if (activeTab === 'floor' && !unifiedTasksLoaded && !unifiedTasksLoading) {
      fetchUnifiedTasks()
    }
    if (activeTab === 'bench' && !unifiedTasksLoaded && !unifiedTasksLoading) {
      fetchUnifiedTasks()
      detectTaskSources()
    }
    if (activeTab === 'bench' && !contextLoaded && !contextLoading) {
      fetchContextFiles()
    }
  }, [activeTab, tasksLoaded, tasksLoading, unifiedTasksLoaded, unifiedTasksLoading, contextLoaded, contextLoading])

  // Poll for tasks and terminals when floor tab is active
  useEffect(() => {
    if (activeTab !== 'floor' || !tasksLoaded) return
    const interval = setInterval(() => {
      vscode.postMessage({ type: 'fetchTasks' })
      vscode.postMessage({ type: 'fetchAllTerminals' })
    }, 10_000)
    return () => clearInterval(interval)
  }, [activeTab, tasksLoaded])

  // Global ⌘K / Ctrl+K opens the command palette. `stopPropagation` +
  // `preventDefault` are intentional — VS Code's webview otherwise
  // intercepts the chord for quick-open (files), which is exactly the
  // behavior the old top-bar search button had and the reason users
  // thought the palette wasn't wired up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        e.stopPropagation()
        setCmdKOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!selectedAgentType || agentTerminals.length === 0) return
    for (const terminal of agentTerminals) {
      if (!terminal.sessionId) continue
      if (sessionTasks[terminal.sessionId]) continue
      if (sessionTasksLoading[terminal.sessionId]) continue
      fetchTasksBySession(terminal.sessionId)
    }
  }, [selectedAgentType, agentTerminals, sessionTasks, sessionTasksLoading])

  useEffect(() => {
    if (activeTab !== 'floor') {
      if (dashboardAutoSelected) {
        setDashboardAutoSelected(false)
      }
      return
    }

    if (selectedAgentType) {
      if (!dashboardAutoSelected) {
        setDashboardAutoSelected(true)
      }
      return
    }

    if (dashboardAutoSelected) return

    const autoAgentType = getAgentWithHighestRunningCount(runningCounts)
    if (!autoAgentType) return

    setDashboardAutoSelected(true)
    setSelectedAgentType(autoAgentType)
    setAgentTerminalsLoading(true)
    vscode.postMessage({ type: 'fetchAgentTerminals', agentType: autoAgentType })
    vscode.postMessage({ type: 'subscribeAgentTerminals', agentType: autoAgentType })
  }, [activeTab, selectedAgentType, dashboardAutoSelected, runningCounts])

  // Data fetching functions
  const fetchTasks = () => {
    setTasksLoading(true)
    setTasksDisplayCount(10)
    vscode.postMessage({ type: 'fetchTasks' })
  }

  const handleLoadMoreTasks = () => {
    setTasksDisplayCount(prev => prev + 10)
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
      // Unsubscribe from live updates
      vscode.postMessage({ type: 'unsubscribeAgentTerminals' })
    } else {
      setSelectedAgentType(agentKey)
      setAgentTerminalsLoading(true)
      vscode.postMessage({ type: 'fetchAgentTerminals', agentType: agentKey })
      // Subscribe to live updates for this agent type
      vscode.postMessage({ type: 'subscribeAgentTerminals', agentType: agentKey })
    }
  }

  const handleCloseAgentTerminals = () => {
    setSelectedAgentType(null)
    setAgentTerminals([])
    vscode.postMessage({ type: 'unsubscribeAgentTerminals' })
  }

  const handleOpenTerminalFile = (filePath: string) => {
    vscode.postMessage({ type: 'openTerminalFile', path: filePath })
  }

  const handleSpawnAgentForTask = (task: UnifiedTask) => {
    setActiveTab('floor')
    setOpenDetailTaskId(task.id)
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

  const handleConnectLinear = () => {
    setShowLinearAuth(true)
  }

  const handleConnectGitHub = () => {
    setShowGitHubAuth(true)
  }

  const handleLinearAuthComplete = () => {
    setShowLinearAuth(false)
    handleUpdateTaskSources({ linear: true })
    detectTaskSources()
    fetchUnifiedTasks()
  }

  const handleLinearAuthCancel = () => {
    setShowLinearAuth(false)
  }

  const handleGitHubAuthComplete = () => {
    setShowGitHubAuth(false)
    handleUpdateTaskSources({ github: true })
    detectTaskSources()
    fetchUnifiedTasks()
  }

  const handleGitHubAuthCancel = () => {
    setShowGitHubAuth(false)
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

  const totalRunning = runningCounts.claude + runningCounts.codex + runningCounts.gemini
    + runningCounts.opencode + runningCounts.cursor + runningCounts.shell
    + Object.values(runningCounts.custom).reduce((a, b) => a + b, 0)

  const { active: activeSwarms } = (() => {
    const a: TaskSummary[] = []
    for (const t of tasks) { if (t.status_counts.running > 0) a.push(t) }
    return { active: a }
  })()

  const handleDispatchSwarm = () => {
    vscode.postMessage({ type: 'dispatchSwarm' })
  }

  if (!settings) {
    return (
      <div className={`swarmify-root ${isLightTheme ? 'theme-light' : 'theme-dark'} sw-app`}>
        <div style={{ display: 'grid', placeItems: 'center', height: '100vh', color: 'var(--ds-text-muted)' }}>
          Loading...
        </div>
      </div>
    )
  }

  return (
    <div className={`swarmify-root ${isLightTheme ? 'theme-light' : 'theme-dark'} sw-app`}>
      <TopBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        activeSwarmCount={activeSwarms.length}
        isLightTheme={isLightTheme}
        onOpenSearch={() => setCmdKOpen(true)}
        onOpenSettings={() => setActiveTab('panel')}
        onToggleTheme={() => vscode.postMessage({ type: 'executeCommand', command: 'workbench.action.toggleLightDarkThemes' })}
        throughputTokensPerSec={activeTab === 'floor' ? floorThroughput : 0}
        watchdogEnabled={watchdogEnabled}
        onToggleWatchdog={() => vscode.postMessage({ type: 'setWatchdogEnabled', value: !watchdogEnabled })}
      />

      {/* Guide overlay */}
      {showGuide && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 30, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center' }}>
          <div style={{ background: 'var(--ds-bg-panel)', border: '1px solid var(--ds-border)', borderRadius: 'var(--r-lg)', padding: 20, maxWidth: 520, width: '90%', maxHeight: '80vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Quick Guide</span>
              <button className="sw-icon-btn" onClick={() => setShowGuide(false)} style={{ width: 24, height: 24 }}>
                x
              </button>
            </div>
            <GuideTab />
          </div>
        </div>
      )}

      {/* Floor (main 3-pane view) */}
      {activeTab === 'floor' && (
        <MissionControlTab
          tasks={tasks}
          tasksLoading={tasksLoading}
          terminals={allTerminals}
          unifiedTasks={unifiedTasks}
          unifiedTasksLoading={unifiedTasksLoading}
          onDispatch={handleDispatchSwarm}
          onNavigate={setActiveTab}
          openDispatchTrigger={openDispatchTrigger}
          openDetailTaskId={openDetailTaskId}
          onDetailTaskConsumed={() => setOpenDetailTaskId(null)}
          onThroughputChange={setFloorThroughput}
        />
      )}

      {/* Bench (2-column work queue) */}
      {activeTab === 'bench' && (
        <BenchTab
          unifiedTasks={unifiedTasks}
          cycleInfo={cycleInfo}
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
          onSpawnAgentForTask={handleSpawnAgentForTask}
          onRefreshTasks={() => { fetchUnifiedTasks() }}
          onRefreshContext={() => { setContextLoaded(false); fetchContextFiles() }}
          onUpdateTaskSources={handleUpdateTaskSources}
          onToggleDir={toggleDirExpanded}
          onOpenFile={openContextFile}
          onInitWorkspaceConfig={handleInitWorkspaceConfig}
          onSaveWorkspaceConfig={handleSaveWorkspaceConfig}
          onDismissTask={handleDismissTask}
          onConnectLinear={handleConnectLinear}
          onConnectGitHub={handleConnectGitHub}
        />
      )}

      {/* Panel (settings - 2-column sidebar layout) */}
      {activeTab === 'panel' && (
        <PanelTab
          settings={settings}
          swarmStatus={swarmStatus}
          runningCounts={runningCounts}
          skillsStatus={skillsStatus}
          builtInAgents={BUILT_IN_AGENTS}
          defaultAgent={defaultAgent}
          secondaryAgent={secondaryAgent}
          installedAgents={installedAgents}
          agentModels={agentModels}
          icons={icons}
          isLightTheme={isLightTheme}
          swarmInstalling={swarmInstalling}
          commandPackInstalling={commandPackInstalling}
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
          onAddAliasClick={handleAddAliasClick}
          onCancelAddAlias={handleCancelAddAlias}
          onSaveAlias={handleSaveAlias}
          onRemoveAlias={handleRemoveAlias}
          onAliasNameChange={handleAliasNameChange}
          onAliasAgentChange={setNewAliasAgent}
          onAliasFlagsChange={setNewAliasFlags}
          linearConnected={availableSources.linear}
          onLinearKeySaved={handleLinearAuthComplete}
          availableSources={availableSources}
          onUpdateTaskSources={handleUpdateTaskSources}
          onConnectLinear={handleConnectLinear}
          onConnectGitHub={handleConnectGitHub}
        />
      )}

      {showLinearAuth && (
        <ApiKeyDialog
          provider="linear"
          onAuthComplete={handleLinearAuthComplete}
          onClose={handleLinearAuthCancel}
        />
      )}

      {showGitHubAuth && (
        <ApiKeyDialog
          provider="github"
          onAuthComplete={handleGitHubAuthComplete}
          onClose={handleGitHubAuthCancel}
        />
      )}

      <ForemanOrb vscode={vscode} />
      <ForemanCursor />

      {cmdKOpen && (
        <CommandPalette
          tasks={unifiedTasks}
          terminals={allTerminals}
          onClose={() => setCmdKOpen(false)}
          onSwitchTab={(tab) => { setCmdKOpen(false); setActiveTab(tab) }}
        />
      )}

      <StatusBar
        activeSwarmCount={activeSwarms.length}
        runningAgentCount={totalRunning}
      />
    </div>
  )
}
