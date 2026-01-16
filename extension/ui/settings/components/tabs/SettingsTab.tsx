import React from 'react'
import { RefreshCw, Download, ExternalLink, Check } from 'lucide-react'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Input } from '../ui/input'
import { SectionHeader } from '../common'
import { getIcon } from '../../utils'
import {
  AgentSettings,
  SwarmStatus,
  SkillsStatus,
  BuiltInAgentConfig,
  CommandAlias,
  NotificationSettings,
  SwarmAgentType,
  PromptPackAgentType,
  IconConfig,
  WorkspaceConfig,
  PrewarmPool,
} from '../../types'
import {
  ALL_SWARM_AGENTS,
  SWARM_AGENT_LABELS,
  AGENT_MODELS,
  AGENT_TITLE_TO_KEY,
  AGENT_KEY_TO_TITLE,
  AGENT_INSTALL_INFO,
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_EDITOR_PREFERENCES,
} from '../../constants'
import { postMessage } from '../../hooks'

interface SettingsTabProps {
  settings: AgentSettings
  swarmStatus: SwarmStatus
  skillsStatus: SkillsStatus | null
  builtInAgents: BuiltInAgentConfig[]
  defaultAgent: string
  installedAgents: Record<string, boolean>
  icons: IconConfig
  isLightTheme: boolean
  swarmInstalling: boolean
  commandPackInstalling: boolean
  prewarmEnabled: boolean
  prewarmLoaded: boolean
  prewarmPools: PrewarmPool[]
  workspaceConfig: WorkspaceConfig | null
  workspaceConfigLoaded: boolean
  workspaceConfigExists: boolean
  // Alias state
  isAddingAlias: boolean
  newAliasName: string
  newAliasAgent: string
  newAliasFlags: string
  aliasError: string
  // Handlers
  onSaveSettings: (settings: AgentSettings) => void
  onInstallSwarmAgent: (agent: SwarmAgentType) => void
  onInstallCommandPack: () => void
  onSetDefaultAgent: (agentTitle: string) => void
  onTogglePrewarm: () => void
  // Alias handlers
  onAddAliasClick: () => void
  onCancelAddAlias: () => void
  onSaveAlias: () => void
  onRemoveAlias: (index: number) => void
  onAliasNameChange: (value: string) => void
  onAliasAgentChange: (value: string) => void
  onAliasFlagsChange: (value: string) => void
  // Workspace config
  onInitWorkspaceConfig: () => void
  onSaveWorkspaceConfig: (config: WorkspaceConfig) => void
}

export function SettingsTab({
  settings,
  swarmStatus,
  skillsStatus,
  builtInAgents,
  defaultAgent,
  installedAgents,
  icons,
  isLightTheme,
  swarmInstalling,
  commandPackInstalling,
  prewarmEnabled,
  prewarmLoaded,
  prewarmPools,
  workspaceConfig,
  workspaceConfigLoaded,
  workspaceConfigExists,
  isAddingAlias,
  newAliasName,
  newAliasAgent,
  newAliasFlags,
  aliasError,
  onSaveSettings,
  onInstallSwarmAgent,
  onInstallCommandPack,
  onSetDefaultAgent,
  onTogglePrewarm,
  onAddAliasClick,
  onCancelAddAlias,
  onSaveAlias,
  onRemoveAlias,
  onAliasNameChange,
  onAliasAgentChange,
  onAliasFlagsChange,
  onInitWorkspaceConfig,
  onSaveWorkspaceConfig,
}: SettingsTabProps) {
  const skillCommands = skillsStatus?.commands ?? []
  const commandPackNames: string[] = ['swarm', ...skillCommands.map((skill) => skill.name)]

  const getSkillSummary = (agent: PromptPackAgentType) => {
    if (!skillsStatus) return null
    const supported = skillCommands.filter(skill => skill.agents[agent]?.supported)
    const installed = supported.filter(skill => skill.agents[agent]?.installed)
    const sample = supported[0]?.agents[agent]
    return {
      total: supported.length,
      installed: installed.length,
      cliAvailable: sample?.cliAvailable ?? false,
      builtIn: supported.filter(skill => skill.agents[agent]?.builtIn).length
    }
  }

  const isAgentInstalled = (agentKey: string): boolean => installedAgents[agentKey] ?? true
  const getInstallInfo = (agentKey: string) => AGENT_INSTALL_INFO[agentKey]

  const updateBuiltIn = (key: keyof AgentSettings['builtIn'], field: 'login' | 'instances', value: boolean | number) => {
    onSaveSettings({
      ...settings,
      builtIn: {
        ...settings.builtIn,
        [key]: { ...settings.builtIn[key], [field]: value }
      }
    })
  }

  const updateBuiltInModel = (key: keyof AgentSettings['builtIn'], value: string) => {
    onSaveSettings({
      ...settings,
      builtIn: {
        ...settings.builtIn,
        [key]: { ...settings.builtIn[key], defaultModel: value || undefined }
      }
    })
  }

  const updateDisplay = (field: keyof AgentSettings['display'], value: boolean) => {
    onSaveSettings({
      ...settings,
      display: { ...settings.display, [field]: value }
    })
  }

  const updateNotifications = (updates: Partial<NotificationSettings>) => {
    const current = settings.notifications ?? DEFAULT_NOTIFICATION_SETTINGS
    onSaveSettings({ ...settings, notifications: { ...current, ...updates } })
  }

  const updateEditor = (updates: Partial<AgentSettings['editor']>) => {
    const current = settings.editor ?? DEFAULT_EDITOR_PREFERENCES
    onSaveSettings({ ...settings, editor: { ...current, ...updates } })
  }

  const toggleSwarmAgent = (agent: SwarmAgentType, enabled: boolean) => {
    const current = settings.swarmEnabledAgents || ALL_SWARM_AGENTS
    const newEnabled = enabled
      ? [...current, agent].filter((v, i, a) => a.indexOf(v) === i)
      : current.filter(a => a !== agent)
    onSaveSettings({ ...settings, swarmEnabledAgents: newEnabled })
  }

  const isSwarmAgentEnabled = (agent: SwarmAgentType): boolean => {
    const enabled = settings.swarmEnabledAgents || ALL_SWARM_AGENTS
    return enabled.includes(agent)
  }

  const markdownViewerEnabled = settings.editor?.markdownViewerEnabled ?? DEFAULT_EDITOR_PREFERENCES.markdownViewerEnabled

  return (
    <div className="space-y-8">
      {/* Swarm Integration */}
      <section>
        <SectionHeader>Swarm Integration</SectionHeader>
        <div className="space-y-2">
          {(['claude', 'codex', 'gemini'] as SwarmAgentType[]).map((agent) => {
            const status = swarmStatus.agents[agent]
            const icon = getIcon(icons[agent], isLightTheme)
            const label = SWARM_AGENT_LABELS[agent]
            const showInstall = status.cliAvailable && !(status.mcpEnabled && status.commandInstalled)
            const statusBadge = status.cliAvailable
              ? status.installed
                ? { text: 'Installed', tone: 'bg-green-500/10 text-green-600 dark:bg-green-500/20 dark:text-green-400' }
                : { text: 'Not installed', tone: 'bg-[var(--secondary)] text-[var(--muted-foreground)]' }
              : { text: 'CLI not found', tone: 'bg-[var(--secondary)] text-[var(--muted-foreground)]' }
            const skillSummary = getSkillSummary(agent)
            const skillBadge = !skillSummary
              ? { text: 'Skills status unknown', tone: 'bg-[var(--secondary)] text-[var(--muted-foreground)]' }
              : skillSummary.total === 0
                ? { text: 'No skills', tone: 'bg-[var(--secondary)] text-[var(--muted-foreground)]' }
                : skillSummary.installed === skillSummary.total
                  ? { text: 'Skills Installed', tone: 'bg-green-500/10 text-green-600 dark:bg-green-500/15 dark:text-green-300' }
                  : { text: `Skills ${skillSummary.installed}/${skillSummary.total}`, tone: 'bg-[var(--secondary)] text-[var(--muted-foreground)]' }

            return (
              <div key={agent} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--muted)]">
                <img src={icon} alt={label} className="w-5 h-5" />
                <span className="text-sm font-medium w-20">{label}</span>
                <div className="flex items-center gap-2 text-xs">
                  <span className={`px-2 py-0.5 rounded ${statusBadge.tone}`}>{statusBadge.text}</span>
                  {status.cliAvailable && (
                    <>
                      <span className={`px-2 py-0.5 rounded ${status.mcpEnabled ? 'bg-green-500/10 text-green-600 dark:bg-green-500/15 dark:text-green-300' : 'bg-[var(--secondary)] text-[var(--muted-foreground)]'}`}>
                        MCP {status.mcpEnabled ? 'Enabled' : 'Missing'}
                      </span>
                      <span className={`px-2 py-0.5 rounded ${status.commandInstalled ? 'bg-green-500/10 text-green-600 dark:bg-green-500/15 dark:text-green-300' : 'bg-[var(--secondary)] text-[var(--muted-foreground)]'}`}>
                        Command {status.commandInstalled ? 'Installed' : 'Missing'}
                      </span>
                    </>
                  )}
                  <span className={`px-2 py-0.5 rounded ${skillBadge.tone}`}>{skillBadge.text}</span>
                </div>
                <div className="flex-1" />
                {showInstall && (
                  <Button
                    size="sm"
                    onClick={() => onInstallSwarmAgent(agent)}
                    disabled={swarmInstalling}
                    title="Installs Swarm and the full command pack"
                  >
                    {swarmInstalling ? (
                      <span className="flex items-center gap-1.5">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Installing...
                      </span>
                    ) : (
                      'Install pack'
                    )}
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* Command Pack */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <SectionHeader className="mb-0">Command Pack</SectionHeader>
          <Button size="sm" onClick={onInstallCommandPack} disabled={commandPackInstalling}>
            {commandPackInstalling ? (
              <span className="flex items-center gap-1.5">
                <RefreshCw className="w-4 h-4 animate-spin" />
                Installing...
              </span>
            ) : (
              'Install'
            )}
          </Button>
        </div>
        <div className="px-4 py-3 rounded-xl bg-[var(--muted)] space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            {commandPackNames.map((name) => (
              <span key={name} className="px-2 py-0.5 rounded bg-[var(--background)] border border-[var(--border)]">
                {name}
              </span>
            ))}
          </div>
          {!skillsStatus && (
            <div className="text-xs text-[var(--muted-foreground)]">
              Skills status unavailable. Install to refresh.
            </div>
          )}
        </div>
      </section>

      {/* Default Agent */}
      <section>
        <SectionHeader>Default Agent</SectionHeader>
        <div className="rounded-xl bg-[var(--muted)]">
          {builtInAgents.filter(a => a.key !== 'shell' && isAgentInstalled(a.key)).length === 0 ? (
            <div className="text-sm text-[var(--muted-foreground)] p-4">
              Install an agent to set a default.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 p-4">
              {builtInAgents
                .filter(a => a.key !== 'shell' && isAgentInstalled(a.key))
                .map(agent => {
                  const isSelected = (AGENT_TITLE_TO_KEY[defaultAgent] || 'claude') === agent.key
                  return (
                    <button
                      key={agent.key}
                      onClick={() => onSetDefaultAgent(AGENT_KEY_TO_TITLE[agent.key] || 'CC')}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        isSelected
                          ? 'border-[var(--primary)] bg-[var(--background)]'
                          : 'border-[var(--border)] bg-[var(--background)] hover:border-[var(--primary)]/60'
                      }`}
                    >
                      <img src={getIcon(agent.icon, isLightTheme)} alt={agent.name} className="w-5 h-5" />
                      <span className="text-sm font-medium">{agent.name}</span>
                      {isSelected && <Check className="w-4 h-4 ml-auto text-[var(--primary)]" />}
                    </button>
                  )
                })}
            </div>
          )}
        </div>
      </section>

      {/* Session Warming */}
      <section>
        <SectionHeader>Session Warming</SectionHeader>
        <div className="px-4 py-3 rounded-xl bg-[var(--muted)]">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Pre-warm sessions</span>
            <button
              className="toggle-switch"
              data-state={prewarmEnabled ? 'on' : 'off'}
              role="switch"
              aria-checked={prewarmEnabled}
              onClick={onTogglePrewarm}
            >
              <span className="toggle-knob" />
            </button>
          </div>
          {prewarmEnabled && prewarmLoaded && prewarmPools.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[var(--border)] space-y-2">
              {prewarmPools.map(pool => (
                <div key={pool.agentType} className="flex items-center gap-3 text-sm">
                  <img
                    src={getIcon(icons[pool.agentType as keyof typeof icons], isLightTheme)}
                    alt={pool.agentType}
                    className="w-4 h-4"
                  />
                  <span className="capitalize w-16">{pool.agentType}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {pool.available} ready{pool.pending > 0 ? `, ${pool.pending} warming` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Built-in Agents */}
      <section>
        <SectionHeader>Built-in Agents</SectionHeader>
        <div className="space-y-2">
          {builtInAgents.filter(a => a.key !== 'shell').map(agent => {
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
                <img src={getIcon(agent.icon, isLightTheme)} alt={agent.name} className="w-5 h-5" />
                <span className="text-sm font-medium w-20">{agent.name}</span>

                {installed ? (
                  <>
                    {isSwarmAgent && (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={isSwarmAgentEnabled(agent.key as SwarmAgentType)}
                          onCheckedChange={(checked) => toggleSwarmAgent(agent.key as SwarmAgentType, !!checked)}
                        />
                        <label className="text-sm text-[var(--muted-foreground)]">Swarm</label>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={config.login}
                        onCheckedChange={(checked) => updateBuiltIn(agent.key as keyof AgentSettings['builtIn'], 'login', !!checked)}
                      />
                      <label className="text-sm text-[var(--muted-foreground)]">Startup</label>
                    </div>
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
                        <option value="">{modelDisabled ? 'No models available' : 'Auto'}</option>
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
          <SectionHeader className="mb-0">Command Aliases</SectionHeader>
          {!isAddingAlias && (
            <Button size="sm" variant="ghost" onClick={onAddAliasClick}>
              Add Alias
            </Button>
          )}
        </div>
        <div className="space-y-2">
          {(settings.aliases || []).map((alias, index) => {
            const agentInfo = builtInAgents.find(a => a.key === alias.agent)
            return (
              <div key={index} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--muted)]">
                <img src={agentInfo?.icon || icons.agents} alt={alias.agent} className="w-5 h-5" />
                <span className="text-sm font-medium">{alias.name}</span>
                <span className="text-xs text-[var(--muted-foreground)]">{agentInfo?.name || alias.agent}</span>
                <code className="text-xs text-[var(--muted-foreground)] bg-[var(--background)] px-2 py-0.5 rounded flex-1 truncate">
                  {alias.flags}
                </code>
                <Button size="sm" variant="ghost" onClick={() => onRemoveAlias(index)}>
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
                    onChange={(e) => onAliasNameChange(e.target.value)}
                    placeholder="Fast"
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--muted-foreground)] mb-1 block">Agent</label>
                  <select
                    value={newAliasAgent}
                    onChange={(e) => onAliasAgentChange(e.target.value)}
                    className="w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm"
                  >
                    {builtInAgents.filter(a => a.key !== 'shell').map(agent => (
                      <option key={agent.key} value={agent.key}>{agent.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--muted-foreground)] mb-1 block">Flags</label>
                  <Input
                    value={newAliasFlags}
                    onChange={(e) => onAliasFlagsChange(e.target.value)}
                    placeholder="--model claude-haiku-4-5-20251001"
                    className="w-full"
                  />
                </div>
              </div>
              {aliasError && <p className="text-xs text-red-600 dark:text-red-400">{aliasError}</p>}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={onCancelAddAlias}>Cancel</Button>
                <Button size="sm" onClick={onSaveAlias}>Save</Button>
              </div>
            </div>
          )}

          {(settings.aliases || []).length === 0 && !isAddingAlias && (
            <div className="text-sm text-[var(--muted-foreground)] px-4 py-3 rounded-xl bg-[var(--muted)]">
              No aliases configured.
            </div>
          )}
        </div>
      </section>

      {/* Display Preferences */}
      <section>
        <SectionHeader>Display</SectionHeader>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--muted)] cursor-pointer">
            <Checkbox
              checked={settings.display?.showFullAgentNames}
              onCheckedChange={(checked) => updateDisplay('showFullAgentNames', !!checked)}
            />
            <span className="text-sm">Show full agent names in tabs</span>
          </label>
          <label className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--muted)] cursor-pointer">
            <Checkbox
              checked={!settings.display?.showLabelsInTitles}
              onCheckedChange={(checked) => updateDisplay('showLabelsInTitles', !checked)}
            />
            <span className="text-sm">Hide labels in tab titles</span>
          </label>
          <label className={`flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--muted)] cursor-pointer ${!settings.display?.showLabelsInTitles ? 'opacity-50' : ''}`}>
            <Checkbox
              checked={settings.display?.labelReplacesTitle ?? false}
              onCheckedChange={(checked) => updateDisplay('labelReplacesTitle', !!checked)}
              disabled={!settings.display?.showLabelsInTitles}
            />
            <span className="text-sm">Labels replace tab title</span>
          </label>
          <label className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--muted)] cursor-pointer">
            <Checkbox
              checked={settings.display?.showSessionIdInTitles}
              onCheckedChange={(checked) => updateDisplay('showSessionIdInTitles', !!checked)}
            />
            <span className="text-sm">Show session IDs in tab titles</span>
          </label>
        </div>
      </section>

      {/* Editor */}
      <section>
        <SectionHeader>Editor</SectionHeader>
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-[var(--muted)]">
          <div className="min-w-0">
            <div className="text-sm font-medium">Agents Markdown Viewer</div>
            <div className="text-xs text-[var(--muted-foreground)]">
              Use the custom editor when opening .md files
            </div>
          </div>
          <button
            className="toggle-switch"
            data-state={markdownViewerEnabled ? 'on' : 'off'}
            role="switch"
            aria-checked={markdownViewerEnabled}
            onClick={() => updateEditor({ markdownViewerEnabled: !markdownViewerEnabled })}
          >
            <span className="toggle-knob" />
          </button>
        </div>
      </section>

      {/* Notifications */}
      <section>
        <SectionHeader>Notifications</SectionHeader>
        <div className="space-y-2">
          <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--muted)]">
            <span className="text-sm">Notify when agent needs approval</span>
            <button
              className="toggle-switch"
              data-state={(settings.notifications ?? DEFAULT_NOTIFICATION_SETTINGS).enabled ? 'on' : 'off'}
              role="switch"
              aria-checked={(settings.notifications ?? DEFAULT_NOTIFICATION_SETTINGS).enabled}
              onClick={() => updateNotifications({ enabled: !(settings.notifications ?? DEFAULT_NOTIFICATION_SETTINGS).enabled })}
            >
              <span className="toggle-knob" />
            </button>
          </div>
          <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--muted)]">
            <span className="text-sm">Style</span>
            <select
              value={(settings.notifications ?? DEFAULT_NOTIFICATION_SETTINGS).style}
              onChange={(e) => updateNotifications({ style: e.target.value as NotificationSettings['style'] })}
              className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm"
            >
              <option value="native">Native OS</option>
              <option value="vscode">VS Code</option>
            </select>
          </div>
        </div>
      </section>

      {/* Context File Symlinking */}
      <section>
        <SectionHeader>Context File Symlinking</SectionHeader>
        <div className="rounded-xl bg-[var(--muted)]">
          {workspaceConfigLoaded && !workspaceConfigExists ? (
            <div className="p-4">
              <p className="text-sm text-[var(--muted-foreground)] mb-3">
                No .agents config found. Initialize to configure context file symlinks.
              </p>
              <Button size="sm" onClick={onInitWorkspaceConfig}>
                Initialize Config
              </Button>
            </div>
          ) : workspaceConfig ? (
            <div className="p-4 space-y-4">
              <div className="space-y-3">
                <div className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider">
                  Context Mappings
                </div>
                {workspaceConfig.context.map((mapping, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-xs bg-[var(--background)] px-2 py-1 rounded">
                      {mapping.source}
                    </span>
                    <span className="text-[var(--muted-foreground)]">-&gt;</span>
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {mapping.aliases.join(', ') || 'no aliases'}
                    </span>
                    <button
                      className="ml-auto text-[var(--muted-foreground)] hover:text-[var(--foreground)] text-xs"
                      onClick={() => {
                        const newContext = workspaceConfig.context.filter((_, i) => i !== idx)
                        onSaveWorkspaceConfig({ ...workspaceConfig, context: newContext })
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  className="text-xs text-[var(--primary)] hover:underline"
                  onClick={() => {
                    const source = prompt('Source file:', 'AGENTS.md')
                    if (!source) return
                    const aliasesStr = prompt('Aliases (comma-separated):', 'CLAUDE.md, GEMINI.md')
                    if (aliasesStr === null) return
                    const aliases = aliasesStr.split(',').map(s => s.trim()).filter(Boolean)
                    const newContext = [...workspaceConfig.context, { source, aliases }]
                    onSaveWorkspaceConfig({ ...workspaceConfig, context: newContext })
                  }}
                >
                  + Add mapping
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4 text-sm text-[var(--muted-foreground)]">
              Loading workspace config...
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
