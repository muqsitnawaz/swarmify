import React, { useState } from 'react'
import { RefreshCw, Check, ChevronDown, ChevronRight } from 'lucide-react'
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
  secondaryAgent: string
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
  userConfigExists: boolean
  availableSources: { markdown: boolean; linear: boolean; github: boolean }
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
  onSetSecondaryAgent: (agentTitle: string) => void
  onTogglePrewarm: () => void
  onUpdateTaskSources: (sources: Partial<AgentSettings['taskSources']>) => void
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
  secondaryAgent,
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
  userConfigExists,
  availableSources,
  isAddingAlias,
  newAliasName,
  newAliasAgent,
  newAliasFlags,
  aliasError,
  onSaveSettings,
  onInstallSwarmAgent,
  onInstallCommandPack,
  onSetDefaultAgent,
  onSetSecondaryAgent,
  onTogglePrewarm,
  onUpdateTaskSources,
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
  const display = settings.display
  const showFullAgentNames = display?.showFullAgentNames ?? true
  const showLabelsInTitles = display?.showLabelsInTitles ?? true
  const showSessionIdInTitles = display?.showSessionIdInTitles ?? true
  const labelReplacesTitle = display?.labelReplacesTitle ?? false
  const showLabelOnlyOnFocus = display?.showLabelOnlyOnFocus ?? false

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

  // Expanded agents state
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set())

  const toggleAgentExpanded = (agent: string) => {
    setExpandedAgents(prev => {
      const next = new Set(prev)
      if (next.has(agent)) next.delete(agent)
      else next.add(agent)
      return next
    })
  }

  // Determine overall agent status
  const getAgentStatus = (agent: SwarmAgentType) => {
    const status = swarmStatus.agents[agent]
    const skillSummary = getSkillSummary(agent)

    if (!status.cliAvailable) {
      return { status: 'not_installed', label: 'Not Installed', canSetup: true }
    }
    if (!status.mcpEnabled || !status.commandInstalled) {
      return { status: 'setup_required', label: 'Setup Required', canSetup: true }
    }
    if (skillSummary && skillSummary.installed < skillSummary.total) {
      return { status: 'ready', label: 'Ready', canSetup: false }
    }
    return { status: 'ready', label: 'Ready', canSetup: false }
  }

  return (
    <div className="space-y-8">
      {/* Agent Setup */}
      <section>
        <SectionHeader>Agent Setup</SectionHeader>
        <div className="space-y-2">
          {(['claude', 'codex', 'gemini'] as SwarmAgentType[]).map((agent) => {
            const agentStatus = swarmStatus.agents[agent]
            const icon = getIcon(icons[agent], isLightTheme)
            const label = SWARM_AGENT_LABELS[agent]
            const { status, label: statusLabel, canSetup } = getAgentStatus(agent)
            const isExpanded = expandedAgents.has(agent)
            const skillSummary = getSkillSummary(agent)
            const config = settings.builtIn[agent as keyof AgentSettings['builtIn']]
            const modelOptions = AGENT_MODELS[agent] || []

            return (
              <div key={agent} className="rounded-xl bg-[var(--muted)] overflow-hidden">
                {/* Collapsed header */}
                <button
                  onClick={() => toggleAgentExpanded(agent)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--background)]/50 transition-colors"
                >
                  <img src={icon} alt={label} className="w-5 h-5" />
                  <span className="text-sm font-medium">{label}</span>
                  <div className="flex-1" />
                  {status === 'ready' ? (
                    <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      {statusLabel}
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (agentStatus.cliAvailable) {
                          onInstallSwarmAgent(agent)
                        } else {
                          toggleAgentExpanded(agent)
                        }
                      }}
                      disabled={swarmInstalling}
                    >
                      {swarmInstalling ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        statusLabel
                      )}
                    </Button>
                  )}
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-[var(--muted-foreground)]" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-[var(--muted-foreground)]" />
                  )}
                </button>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-0 border-t border-[var(--border)]">
                    <div className="pt-3 space-y-3">
                      {/* Status details */}
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${agentStatus.cliAvailable ? 'bg-green-500' : 'bg-[var(--muted-foreground)]'}`} />
                          <span className="text-[var(--muted-foreground)]">CLI</span>
                          <span>{agentStatus.cliAvailable ? 'Installed' : 'Missing'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${agentStatus.mcpEnabled ? 'bg-green-500' : 'bg-[var(--muted-foreground)]'}`} />
                          <span className="text-[var(--muted-foreground)]">MCP</span>
                          <span>{agentStatus.mcpEnabled ? 'Connected' : 'Missing'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${skillSummary && skillSummary.installed === skillSummary.total ? 'bg-green-500' : 'bg-[var(--muted-foreground)]'}`} />
                          <span className="text-[var(--muted-foreground)]">Skills</span>
                          <span>{skillSummary ? `${skillSummary.installed}/${skillSummary.total}` : '?'}</span>
                        </div>
                      </div>

                      {/* Install button if not ready */}
                      {canSetup && agentStatus.cliAvailable && (
                        <Button
                          size="sm"
                          onClick={() => onInstallSwarmAgent(agent)}
                          disabled={swarmInstalling}
                          className="w-full"
                        >
                          {swarmInstalling ? (
                            <span className="flex items-center gap-1.5">
                              <RefreshCw className="w-3 h-3 animate-spin" />
                              Installing...
                            </span>
                          ) : (
                            'Install Swarm Integration'
                          )}
                        </Button>
                      )}

                      {/* Install CLI hint if not available */}
                      {!agentStatus.cliAvailable && (
                        <div className="text-xs text-[var(--muted-foreground)]">
                          {AGENT_INSTALL_INFO[agent]?.command && (
                            <div className="flex items-center gap-2">
                              <code className="px-2 py-1 rounded bg-[var(--background)] flex-1 truncate">
                                {AGENT_INSTALL_INFO[agent].command}
                              </code>
                              <button
                                onClick={() => navigator.clipboard.writeText(AGENT_INSTALL_INFO[agent].command!)}
                                className="px-2 py-1 text-[var(--primary)] hover:underline"
                              >
                                Copy
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Config options when ready */}
                      {status === 'ready' && config && (
                        <div className="flex items-center gap-4 pt-2 border-t border-[var(--border)]">
                          <label className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={config.login}
                              onCheckedChange={(checked) => updateBuiltIn(agent as keyof AgentSettings['builtIn'], 'login', !!checked)}
                            />
                            Open on launch
                          </label>
                          {config.login && (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-[var(--muted-foreground)]">Instances:</span>
                              <Input
                                type="number"
                                min={1}
                                max={10}
                                value={config.instances}
                                onChange={(e) => updateBuiltIn(agent as keyof AgentSettings['builtIn'], 'instances', Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                                className="w-14 text-center h-8"
                              />
                            </div>
                          )}
                          {modelOptions.length > 0 && (
                            <div className="flex items-center gap-2 ml-auto">
                              <span className="text-xs text-[var(--muted-foreground)]">Model:</span>
                              <select
                                value={config.defaultModel || ''}
                                onChange={(e) => updateBuiltInModel(agent as keyof AgentSettings['builtIn'], e.target.value)}
                                className="h-8 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs"
                              >
                                <option value="">Auto</option>
                                {modelOptions.map(model => (
                                  <option key={model} value={model}>{model}</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>


      {/* Default Agent */}
      <section>
        <SectionHeader>Primary Agent</SectionHeader>
        <div className="text-xs text-[var(--muted-foreground)] mb-2">
          Use Cmd+Shift+A to start {builtInAgents.find(a => a.key === (AGENT_TITLE_TO_KEY[defaultAgent] || 'claude'))?.name || 'Claude'}
        </div>
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

      {/* Secondary Default Agent */}
      <section>
        <SectionHeader>Secondary Agent</SectionHeader>
        <div className="text-xs text-[var(--muted-foreground)] mb-2">
          Use Cmd+Shift+B to start {builtInAgents.find(a => a.key === (AGENT_TITLE_TO_KEY[secondaryAgent] || 'codex'))?.name || 'Codex'}
        </div>
        <div className="rounded-xl bg-[var(--muted)]">
          {builtInAgents.filter(a => a.key !== 'shell' && isAgentInstalled(a.key)).length === 0 ? (
            <div className="text-sm text-[var(--muted-foreground)] p-4">
              Install an agent to set a secondary default.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 p-4">
              {builtInAgents
                .filter(a => a.key !== 'shell' && isAgentInstalled(a.key))
                .map(agent => {
                  const primaryKey = (AGENT_TITLE_TO_KEY[defaultAgent] || 'claude')
                  const isPrimary = primaryKey === agent.key
                  const isSelected = (AGENT_TITLE_TO_KEY[secondaryAgent] || 'codex') === agent.key
                  return (
                    <button
                      key={agent.key}
                      onClick={() => onSetSecondaryAgent(AGENT_KEY_TO_TITLE[agent.key] || 'CX')}
                      disabled={isPrimary}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        isSelected
                          ? 'border-[var(--primary)] bg-[var(--background)]'
                          : 'border-[var(--border)] bg-[var(--background)] hover:border-[var(--primary)]/60'
                      } ${isPrimary ? 'opacity-50 cursor-not-allowed' : ''}`}
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
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-[var(--muted)]">
            <span className="text-sm">Show full agent names in tabs</span>
            <button
              className="toggle-switch"
              data-state={showFullAgentNames ? 'on' : 'off'}
              role="switch"
              aria-checked={showFullAgentNames}
              onClick={() => updateDisplay('showFullAgentNames', !showFullAgentNames)}
            >
              <span className="toggle-knob" />
            </button>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-[var(--muted)]">
            <span className="text-sm">Hide labels in tab titles</span>
            <button
              className="toggle-switch"
              data-state={showLabelsInTitles ? 'off' : 'on'}
              role="switch"
              aria-checked={!showLabelsInTitles}
              onClick={() => updateDisplay('showLabelsInTitles', !showLabelsInTitles)}
            >
              <span className="toggle-knob" />
            </button>
          </div>
          <div
            className={`flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-[var(--muted)] ${
              !showLabelsInTitles ? 'opacity-50' : ''
            }`}
          >
            <span className="text-sm">Labels replace tab title</span>
            <button
              className="toggle-switch disabled:cursor-not-allowed disabled:opacity-40"
              data-state={labelReplacesTitle ? 'on' : 'off'}
              role="switch"
              aria-checked={labelReplacesTitle}
              disabled={!showLabelsInTitles}
              onClick={() => updateDisplay('labelReplacesTitle', !labelReplacesTitle)}
            >
              <span className="toggle-knob" />
            </button>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-[var(--muted)]">
            <span className="text-sm">Show session IDs in tab titles</span>
            <button
              className="toggle-switch"
              data-state={showSessionIdInTitles ? 'on' : 'off'}
              role="switch"
              aria-checked={showSessionIdInTitles}
              onClick={() => updateDisplay('showSessionIdInTitles', !showSessionIdInTitles)}
            >
              <span className="toggle-knob" />
            </button>
          </div>
          <div
            className={`flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-[var(--muted)] ${
              !showLabelsInTitles ? 'opacity-50' : ''
            }`}
          >
            <span className="text-sm">Hide labels when terminal is not focused</span>
            <button
              className="toggle-switch disabled:cursor-not-allowed disabled:opacity-40"
              data-state={showLabelOnlyOnFocus ? 'on' : 'off'}
              role="switch"
              aria-checked={showLabelOnlyOnFocus}
              disabled={!showLabelsInTitles}
              onClick={() => updateDisplay('showLabelOnlyOnFocus', !showLabelOnlyOnFocus)}
            >
              <span className="toggle-knob" />
            </button>
          </div>
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

      {/* Task Sources */}
      <section>
        <SectionHeader>Task Sources</SectionHeader>
        <div className="px-4 py-3 rounded-xl bg-[var(--muted)]">
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={settings.taskSources?.markdown ?? true}
                onCheckedChange={(checked) => onUpdateTaskSources({ markdown: Boolean(checked) })}
              />
              Markdown
            </label>
            <label className={`flex items-center gap-2 text-sm ${!availableSources.linear ? 'opacity-50' : 'cursor-pointer'}`}>
              <Checkbox
                checked={settings.taskSources?.linear ?? false}
                disabled={!availableSources.linear}
                onCheckedChange={(checked) => onUpdateTaskSources({ linear: Boolean(checked) })}
              />
              Linear {!availableSources.linear && <span className="text-xs text-[var(--muted-foreground)]">(MCP not configured)</span>}
            </label>
            <label className={`flex items-center gap-2 text-sm ${!availableSources.github ? 'opacity-50' : 'cursor-pointer'}`}>
              <Checkbox
                checked={settings.taskSources?.github ?? false}
                disabled={!availableSources.github}
                onCheckedChange={(checked) => onUpdateTaskSources({ github: Boolean(checked) })}
              />
              GitHub {!availableSources.github && <span className="text-xs text-[var(--muted-foreground)]">(MCP not configured)</span>}
            </label>
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
                {userConfigExists
                  ? 'No workspace .agents config found. Using ~/.agents defaults.'
                  : 'No .agents config found. Initialize to configure context file symlinks.'}
              </p>
              {userConfigExists && (
                <p className="text-xs text-[var(--muted-foreground)] mb-3">
                  Initialize a workspace config to override user defaults here.
                </p>
              )}
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
