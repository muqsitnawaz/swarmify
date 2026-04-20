import React from 'react'
import { RefreshCw, Plus, Minus, Cpu, Radio, Waypoints } from 'lucide-react'
import { Input } from '../ui/input'
import { WorkspaceConfigSection } from '../common'
import { AgentDial } from './AgentDial'
import { StatusBank } from './StatusBank'
import type { StatusBankItem, StatusBankLevel } from './StatusBank'
import type {
  AgentSettings,
  SwarmStatus,
  SkillsStatus,
  BuiltInAgentConfig,
  NotificationSettings,
  SwarmAgentType,
  PromptPackAgentType,
  IconConfig,
  WorkspaceConfig,
  PrewarmPool,
  QuickLaunchSlot,
  RunningCounts,
} from '../../types'
import {
  ALL_SWARM_AGENTS,
  SWARM_AGENT_LABELS,
  AGENT_TITLE_TO_KEY,
  AGENT_KEY_TO_TITLE,
  AGENT_INSTALL_INFO,
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_EDITOR_PREFERENCES,
} from '../../constants'
import { getIcon, formatPreviewTerminalTitle } from '../../utils'

export interface PanelTabProps {
  settings: AgentSettings
  swarmStatus: SwarmStatus
  runningCounts: RunningCounts
  skillsStatus: SkillsStatus | null
  builtInAgents: BuiltInAgentConfig[]
  defaultAgent: string
  secondaryAgent: string
  installedAgents: Record<string, boolean>
  agentModels: Record<string, string[]>
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
  isAddingAlias: boolean
  newAliasName: string
  newAliasAgent: string
  newAliasFlags: string
  aliasError: string
  onSaveSettings: (settings: AgentSettings) => void
  onInstallSwarmAgent: (agent: SwarmAgentType) => void
  onInstallCommandPack: () => void
  onSetDefaultAgent: (agentTitle: string) => void
  onSetSecondaryAgent: (agentTitle: string) => void
  onTogglePrewarm: () => void
  onUpdateTaskSources: (sources: Partial<AgentSettings['taskSources']>) => void
  onAddAliasClick: () => void
  onCancelAddAlias: () => void
  onSaveAlias: () => void
  onRemoveAlias: (index: number) => void
  onAliasNameChange: (value: string) => void
  onAliasAgentChange: (value: string) => void
  onAliasFlagsChange: (value: string) => void
  onInitWorkspaceConfig: () => void
  onSaveWorkspaceConfig: (config: WorkspaceConfig) => void
  onConnectLinear: () => void
  onConnectGitHub: () => void
}

function statusLevel(value: boolean): StatusBankLevel {
  return value ? 'running' : 'idle'
}

function skillGauge(total: number, installed: number) {
  if (total <= 0) return 12
  return (installed / total) * 100
}

export function PanelTab({
  settings,
  swarmStatus,
  runningCounts,
  skillsStatus,
  builtInAgents,
  defaultAgent,
  secondaryAgent,
  installedAgents,
  agentModels,
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
  onConnectLinear,
  onConnectGitHub,
}: PanelTabProps) {
  const skillCommands = skillsStatus?.commands ?? []
  const display = settings.display
  const notifications = settings.notifications ?? DEFAULT_NOTIFICATION_SETTINGS
  const editor = settings.editor ?? DEFAULT_EDITOR_PREFERENCES
  const primaryKey = AGENT_TITLE_TO_KEY[defaultAgent] || 'claude'
  const secondaryKey = AGENT_TITLE_TO_KEY[secondaryAgent] || 'codex'
  const previewPrefix = 'CX'
  const previewSessionChunk = 'a1b2c3d4'
  const previewAutoLabel = display.autoLabelInTabTitles ? 'Agent Terminals' : null
  const previewDisplay = {
    showFullAgentNames: display.showFullAgentNames,
    showLabelsInTitles: display.showLabelsInTitles,
    autoLabelInTabTitles: display.autoLabelInTabTitles,
    showSessionIdInTitles: display.showSessionIdInTitles,
    labelReplacesTitle: display.labelReplacesTitle,
    showLabelOnlyOnFocus: display.showLabelOnlyOnFocus,
  }
  const previewFocused = formatPreviewTerminalTitle(previewPrefix, previewDisplay, {
    label: previewAutoLabel,
    sessionChunk: previewSessionChunk,
    isFocused: true,
  })
  const previewUnfocused = formatPreviewTerminalTitle(previewPrefix, previewDisplay, {
    label: previewAutoLabel,
    sessionChunk: previewSessionChunk,
    isFocused: false,
  })
  const previewManual = formatPreviewTerminalTitle(previewPrefix, previewDisplay, {
    label: 'Agent Terminals',
    sessionChunk: previewSessionChunk,
    isFocused: true,
  })
  const previewIcon = getIcon(icons.codex, isLightTheme)

  const getSkillSummary = (agent: PromptPackAgentType) => {
    const supported = skillCommands.filter(skill => skill.agents[agent]?.supported)
    const installed = supported.filter(skill => skill.agents[agent]?.installed)
    return {
      total: supported.length,
      installed: installed.length,
    }
  }

  const getAgentStatus = (agent: SwarmAgentType) => {
    const agentStatus = swarmStatus.agents[agent]
    const count = (runningCounts as Record<string, number>)[agent] ?? 0
    if (!agentStatus?.cliAvailable) return { label: 'CLI Missing', level: 'failed' as const }
    if (count > 0) return { label: `${count} running`, level: 'running' as const }
    if (!agentStatus?.mcpEnabled || !agentStatus?.commandInstalled) return { label: 'Setup', level: 'pending' as const }
    return { label: 'Standby', level: 'idle' as const }
  }

  const updateBuiltIn = (
    key: keyof AgentSettings['builtIn'],
    field: 'login' | 'instances',
    value: boolean | number
  ) => {
    onSaveSettings({
      ...settings,
      builtIn: {
        ...settings.builtIn,
        [key]: { ...settings.builtIn[key], [field]: value },
      },
    })
  }

  const updateBuiltInModel = (key: keyof AgentSettings['builtIn'], value: string) => {
    onSaveSettings({
      ...settings,
      builtIn: {
        ...settings.builtIn,
        [key]: { ...settings.builtIn[key], defaultModel: value || undefined },
      },
    })
  }

  const updateDisplay = (field: keyof AgentSettings['display'], value: boolean) => {
    onSaveSettings({
      ...settings,
      display: { ...settings.display, [field]: value },
    })
  }

  const updateNotifications = (updates: Partial<NotificationSettings>) => {
    onSaveSettings({
      ...settings,
      notifications: { ...notifications, ...updates },
    })
  }

  const updateEditor = (enabled: boolean) => {
    onSaveSettings({
      ...settings,
      editor: { ...editor, markdownViewerEnabled: enabled },
    })
  }

  const toggleSwarmAgent = (agent: SwarmAgentType, enabled: boolean) => {
    const current = settings.swarmEnabledAgents || ALL_SWARM_AGENTS
    const next = enabled
      ? [...current, agent].filter((value, index, array) => array.indexOf(value) === index)
      : current.filter(value => value !== agent)
    onSaveSettings({
      ...settings,
      swarmEnabledAgents: next,
    })
  }

  const setQuickLaunchSlot = (key: 'slot1' | 'slot2' | 'slot3', value?: QuickLaunchSlot) => {
    onSaveSettings({
      ...settings,
      quickLaunch: {
        ...settings.quickLaunch,
        [key]: value,
      },
    })
  }

  const dialOptions = builtInAgents
    .filter(agent => agent.key !== 'shell' && (installedAgents[agent.key] ?? true))
    .map(agent => ({
      key: agent.key,
      label: agent.name,
      caption: agent.key === primaryKey ? 'Primary route selected' : 'Ready for launch',
    }))

  const bankItems: StatusBankItem[] = [
    {
      key: 'agents-cli',
      label: 'Agents CLI',
      value: swarmStatus.agentsCliAvailable ? (swarmStatus.agentsCliVersion ?? 'online') : 'offline',
      level: statusLevel(Boolean(swarmStatus.agentsCliAvailable)),
      gauge: swarmStatus.agentsCliAvailable ? 100 : 10,
    },
    {
      key: 'mcp',
      label: 'Swarm MCP',
      value: swarmStatus.mcpEnabled ? 'linked' : 'offline',
      level: statusLevel(Boolean(swarmStatus.mcpEnabled)),
      gauge: swarmStatus.mcpEnabled ? 100 : 10,
    },
    {
      key: 'command-pack',
      label: 'Command Pack',
      value: swarmStatus.commandInstalled ? `${skillCommands.length + 1} cmds` : 'missing',
      level: swarmStatus.commandInstalled ? 'running' : 'pending',
      gauge: swarmStatus.commandInstalled ? 100 : 48,
    },
    {
      key: 'prewarm',
      label: 'Session Warming',
      value: prewarmEnabled ? `${prewarmPools.reduce((sum, pool) => sum + pool.available, 0)} ready` : 'standby',
      level: prewarmEnabled ? 'running' : 'idle',
      gauge: prewarmEnabled ? 78 : 12,
    },
  ]

  const agentRows = (['claude', 'codex', 'gemini', 'opencode'] as SwarmAgentType[]).map(agent => {
    const status = getAgentStatus(agent)
    const skillSummary = agent === 'opencode' ? { total: 0, installed: 0 } : getSkillSummary(agent)
    return {
      agent,
      icon: getIcon(icons[agent], isLightTheme),
      config: settings.builtIn[agent],
      modelOptions: agentModels[agent] || [],
      status,
      skillSummary,
    }
  })

  return (
    <div className="sw-panel-tab">
      <div className="sw-panel-grid sw-panel-grid-top">
        <div className="sw-panel-summary-stack">
          <StatusBank title="Control Bus" items={bankItems} />
          <section className="sw-panel-section">
            <div className="sw-panel-section-head">Readout Strip</div>
            <div className="sw-panel-readouts">
              <div className="sw-panel-readout-block">
                <span className="sw-section-label">Focused Title</span>
                <div className="sw-readout glow">{previewFocused}</div>
              </div>
              <div className="sw-panel-readout-block">
                <span className="sw-section-label">Background Title</span>
                <div className="sw-readout">{previewUnfocused}</div>
              </div>
              {!display.autoLabelInTabTitles && (
                <div className="sw-panel-readout-block">
                  <span className="sw-section-label">Manual Label</span>
                  <div className="sw-readout">{previewManual}</div>
                </div>
              )}
            </div>
            <div className="sw-panel-preview-row">
              <img src={previewIcon} alt="Codex" className="sw-panel-preview-icon" />
              <span className="sw-panel-preview-caption">Terminal title live preview</span>
            </div>
          </section>
        </div>

        <div className="sw-panel-dials">
          <AgentDial
            title="Primary Agent"
            value={primaryKey}
            options={dialOptions}
            onChange={(key) => onSetDefaultAgent(AGENT_KEY_TO_TITLE[key] || 'CC')}
          />
          <AgentDial
            title="Secondary Agent"
            value={secondaryKey}
            options={dialOptions.map(option => ({
              ...option,
              disabled: option.key === primaryKey,
              caption: option.key === primaryKey ? 'Reserved by primary route' : 'Hot standby route',
            }))}
            onChange={(key) => {
              if (key !== primaryKey) onSetSecondaryAgent(AGENT_KEY_TO_TITLE[key] || 'CX')
            }}
          />
        </div>
      </div>

      <div className="sw-panel-grid sw-panel-grid-main">
        <section className="sw-panel-section">
          <div className="sw-panel-section-head">Agent Bus</div>
          <div className="sw-panel-agent-stack">
            {agentRows.map(({ agent, icon, config, modelOptions, status, skillSummary }) => (
              <div key={agent} className="sw-panel-agent-card">
                <div className="sw-panel-agent-head">
                  <div className="sw-panel-agent-ident">
                    <img src={icon} alt={agent} className="sw-panel-agent-icon" />
                    <div>
                      <div className="sw-panel-agent-title">{SWARM_AGENT_LABELS[agent]}</div>
                      <div className="sw-panel-agent-sub">{status.label}</div>
                    </div>
                  </div>
                  <div className="sw-panel-agent-actions">
                    <span className={`sw-badge ${status.level}`}>{status.label}</span>
                    {status.level !== 'running' && (
                      <button
                        type="button"
                        className="sw-btn secondary sm"
                        onClick={() => onInstallSwarmAgent(agent)}
                        disabled={swarmInstalling || !swarmStatus.agents[agent]?.cliAvailable}
                      >
                        {swarmInstalling ? <RefreshCw size={12} className="animate-spin" /> : 'Setup'}
                      </button>
                    )}
                  </div>
                </div>
                <div className="sw-panel-agent-controls">
                  <label className="sw-panel-rocker">
                    <span>Autostart</span>
                    <button
                      type="button"
                      className="toggle-switch"
                      data-state={config.login ? 'on' : 'off'}
                      role="switch"
                      aria-checked={config.login}
                      onClick={() => updateBuiltIn(agent, 'login', !config.login)}
                    >
                      <span className="toggle-knob" />
                    </button>
                  </label>
                  <label className="sw-panel-rocker">
                    <span>Swarm Enabled</span>
                    <button
                      type="button"
                      className="toggle-switch"
                      data-state={(settings.swarmEnabledAgents || ALL_SWARM_AGENTS).includes(agent) ? 'on' : 'off'}
                      role="switch"
                      aria-checked={(settings.swarmEnabledAgents || ALL_SWARM_AGENTS).includes(agent)}
                      onClick={() =>
                        toggleSwarmAgent(agent, !(settings.swarmEnabledAgents || ALL_SWARM_AGENTS).includes(agent))
                      }
                    >
                      <span className="toggle-knob" />
                    </button>
                  </label>
                  <div className="sw-panel-stepper">
                    <span>Instances</span>
                    <div className="sw-panel-stepper-controls">
                      <button
                        type="button"
                        className="sw-icon-btn"
                        onClick={() => updateBuiltIn(agent, 'instances', Math.max(1, config.instances - 1))}
                      >
                        <Minus size={12} />
                      </button>
                      <div className="sw-readout">{config.instances}</div>
                      <button
                        type="button"
                        className="sw-icon-btn"
                        onClick={() => updateBuiltIn(agent, 'instances', Math.min(10, config.instances + 1))}
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                  </div>
                  <label className="sw-panel-select">
                    <span>Default Model</span>
                    <select
                      value={config.defaultModel || ''}
                      onChange={(event) => updateBuiltInModel(agent, event.target.value)}
                    >
                      <option value="">Auto</option>
                      {modelOptions.map(model => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="sw-panel-agent-foot">
                  <div className="sw-panel-gauge-meta">
                    <span className="sw-section-label">Skills</span>
                    <span className="sw-readout">
                      {skillSummary.total ? `${skillSummary.installed}/${skillSummary.total}` : 'N/A'}
                    </span>
                  </div>
                  <div className="sw-gauge">
                    <div
                      className={`sw-gauge-fill ${status.level === 'failed' ? 'danger' : status.level === 'pending' ? 'warn' : ''}`.trim()}
                      style={{ width: `${skillGauge(skillSummary.total, skillSummary.installed)}%` }}
                    />
                  </div>
                </div>
                {!swarmStatus.agents[agent]?.cliAvailable && AGENT_INSTALL_INFO[agent]?.command && (
                  <div className="sw-panel-inline-hint sw-readout">
                    {AGENT_INSTALL_INFO[agent]?.command}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <div className="sw-panel-column">
          <section className="sw-panel-section">
            <div className="sw-panel-section-head">Launch Matrix</div>
            <div className="sw-panel-quicklaunch">
              {([
                { key: 'slot1', shortcut: 'Cmd+Shift+1' },
                { key: 'slot2', shortcut: 'Cmd+Shift+2' },
                { key: 'slot3', shortcut: 'Cmd+Shift+3' },
              ] as const).map(({ key, shortcut }) => {
                const slot = settings.quickLaunch?.[key]
                const models = slot?.agent ? agentModels[slot.agent] || [] : []
                return (
                  <div key={key} className="sw-panel-launch-row">
                    <div className="sw-readout">{shortcut}</div>
                    <select
                      value={slot?.agent || ''}
                      onChange={(event) => {
                        const agent = event.target.value
                        setQuickLaunchSlot(key, agent ? { agent } : undefined)
                      }}
                    >
                      <option value="">Off</option>
                      {dialOptions.map(option => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={slot?.model || ''}
                      disabled={!slot?.agent}
                      onChange={(event) => {
                        if (!slot?.agent) return
                        setQuickLaunchSlot(key, {
                          ...slot,
                          model: event.target.value || undefined,
                        })
                      }}
                    >
                      <option value="">Default model</option>
                      {models.map(model => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="sw-panel-section">
            <div className="sw-panel-section-head">Routing</div>
            <div className="sw-panel-toggle-list">
              <label className="sw-panel-rocker">
                <span>Markdown Tasks</span>
                <button
                  type="button"
                  className="toggle-switch"
                  data-state={settings.taskSources?.markdown ? 'on' : 'off'}
                  role="switch"
                  aria-checked={settings.taskSources?.markdown}
                  onClick={() => onUpdateTaskSources({ markdown: !(settings.taskSources?.markdown ?? true) })}
                >
                  <span className="toggle-knob" />
                </button>
              </label>
              <label className="sw-panel-rocker">
                <span>Linear Feed</span>
                {availableSources.linear ? (
                  <button
                    type="button"
                    className="toggle-switch"
                    data-state={settings.taskSources?.linear ? 'on' : 'off'}
                    role="switch"
                    aria-checked={settings.taskSources?.linear}
                    onClick={() => onUpdateTaskSources({ linear: !(settings.taskSources?.linear ?? false) })}
                  >
                    <span className="toggle-knob" />
                  </button>
                ) : (
                  <button type="button" className="sw-btn secondary sm" onClick={onConnectLinear}>
                    Connect
                  </button>
                )}
              </label>
              <label className="sw-panel-rocker">
                <span>GitHub Feed</span>
                {availableSources.github ? (
                  <button
                    type="button"
                    className="toggle-switch"
                    data-state={settings.taskSources?.github ? 'on' : 'off'}
                    role="switch"
                    aria-checked={settings.taskSources?.github}
                    onClick={() => onUpdateTaskSources({ github: !(settings.taskSources?.github ?? false) })}
                  >
                    <span className="toggle-knob" />
                  </button>
                ) : (
                  <button type="button" className="sw-btn secondary sm" onClick={onConnectGitHub}>
                    Connect
                  </button>
                )}
              </label>
              <label className="sw-panel-rocker">
                <span>Warm Pool</span>
                <button
                  type="button"
                  className="toggle-switch"
                  data-state={prewarmEnabled ? 'on' : 'off'}
                  role="switch"
                  aria-checked={prewarmEnabled}
                  onClick={onTogglePrewarm}
                >
                  <span className="toggle-knob" />
                </button>
              </label>
            </div>
            {prewarmEnabled && prewarmLoaded && prewarmPools.length > 0 && (
              <div className="sw-panel-pool-list">
                {prewarmPools.map(pool => (
                  <div key={pool.agentType} className="sw-panel-pool-row">
                    <span className="sw-section-label">{pool.agentType}</span>
                    <div className="sw-readout">{pool.available} ready</div>
                    <div className="sw-readout">{pool.pending} warming</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="sw-panel-section">
            <div className="sw-panel-section-head">Display Bank</div>
            <div className="sw-panel-toggle-list">
              {[
                ['showFullAgentNames', 'Full Agent Names'],
                ['showLabelsInTitles', 'Labels In Titles'],
                ['autoLabelInTabTitles', 'Auto Labels'],
                ['labelReplacesTitle', 'Replace Base Title'],
                ['showSessionIdInTitles', 'Session ID'],
                ['showLabelOnlyOnFocus', 'Hide Labels Off Focus'],
              ].map(([field, label]) => (
                <label key={field} className="sw-panel-rocker">
                  <span>{label}</span>
                  <button
                    type="button"
                    className="toggle-switch"
                    data-state={display[field as keyof typeof display] ? 'on' : 'off'}
                    role="switch"
                    aria-checked={display[field as keyof typeof display]}
                    onClick={() =>
                      updateDisplay(
                        field as keyof AgentSettings['display'],
                        !display[field as keyof typeof display]
                      )
                    }
                  >
                    <span className="toggle-knob" />
                  </button>
                </label>
              ))}
              <label className="sw-panel-rocker">
                <span>Markdown Viewer</span>
                <button
                  type="button"
                  className="toggle-switch"
                  data-state={editor.markdownViewerEnabled ? 'on' : 'off'}
                  role="switch"
                  aria-checked={editor.markdownViewerEnabled}
                  onClick={() => updateEditor(!editor.markdownViewerEnabled)}
                >
                  <span className="toggle-knob" />
                </button>
              </label>
              <label className="sw-panel-rocker">
                <span>Approval Alerts</span>
                <button
                  type="button"
                  className="toggle-switch"
                  data-state={notifications.enabled ? 'on' : 'off'}
                  role="switch"
                  aria-checked={notifications.enabled}
                  onClick={() => updateNotifications({ enabled: !notifications.enabled })}
                >
                  <span className="toggle-knob" />
                </button>
              </label>
            </div>
            <label className="sw-panel-select">
              <span>Alert Style</span>
              <select
                value={notifications.style}
                onChange={(event) =>
                  updateNotifications({ style: event.target.value as NotificationSettings['style'] })
                }
              >
                <option value="native">Native OS</option>
                <option value="vscode">VS Code</option>
              </select>
            </label>
          </section>
        </div>
      </div>

      <div className="sw-panel-grid sw-panel-grid-bottom">
        <section className="sw-panel-section">
          <div className="sw-panel-section-head">Alias Rack</div>
          <div className="sw-panel-alias-list">
            {settings.aliases.map((alias, index) => (
              <div key={`${alias.name}-${index}`} className="sw-panel-alias-row">
                <div className="sw-panel-alias-head">
                  <span className="sw-readout glow">{alias.name}</span>
                  <span className="sw-pill">{alias.agent}</span>
                </div>
                <div className="sw-panel-alias-flags sw-readout">{alias.flags || 'No flags'}</div>
                <button type="button" className="sw-btn danger sm" onClick={() => onRemoveAlias(index)}>
                  Remove
                </button>
              </div>
            ))}
            {settings.aliases.length === 0 && !isAddingAlias && (
              <div className="sw-empty">
                <span className="sw-empty-title">Alias rack empty</span>
                <span className="sw-empty-sub">Add shortcuts for common launch profiles.</span>
              </div>
            )}
            {isAddingAlias ? (
              <div className="sw-panel-alias-form">
                <label className="sw-panel-select">
                  <span>Name</span>
                  <Input value={newAliasName} onChange={(event) => onAliasNameChange(event.target.value)} placeholder="Fast" />
                </label>
                <label className="sw-panel-select">
                  <span>Agent</span>
                  <select value={newAliasAgent} onChange={(event) => onAliasAgentChange(event.target.value)}>
                    {dialOptions.map(option => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="sw-panel-select">
                  <span>Flags</span>
                  <Input
                    value={newAliasFlags}
                    onChange={(event) => onAliasFlagsChange(event.target.value)}
                    placeholder="--model gpt-5.4"
                  />
                </label>
                {aliasError && <div className="sw-panel-error">{aliasError}</div>}
                <div className="sw-panel-inline-actions">
                  <button type="button" className="sw-btn secondary sm" onClick={onCancelAddAlias}>
                    Cancel
                  </button>
                  <button type="button" className="sw-btn primary sm" onClick={onSaveAlias}>
                    Save Alias
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="sw-btn secondary" onClick={onAddAliasClick}>
                <Waypoints size={12} />
                Add Alias
              </button>
            )}
          </div>
        </section>

        <section className="sw-panel-section">
          <div className="sw-panel-section-head">Command Pack</div>
          <div className="sw-panel-command-pack">
            <div className="sw-panel-command-card">
              <div className="sw-panel-command-line">
                <Cpu size={14} />
                <span>Swarm + skills installed in agent CLIs</span>
              </div>
              <div className="sw-panel-command-metrics">
                <div className="sw-readout glow">{skillCommands.length + 1} command paths</div>
                <div className="sw-readout">{swarmStatus.commandInstalled ? 'active' : 'setup required'}</div>
              </div>
              <button
                type="button"
                className="sw-btn primary"
                onClick={onInstallCommandPack}
                disabled={commandPackInstalling}
              >
                {commandPackInstalling ? <RefreshCw size={12} className="animate-spin" /> : <Radio size={12} />}
                {swarmStatus.commandInstalled ? 'Reinstall Pack' : 'Install Pack'}
              </button>
            </div>
            <div className="sw-panel-skill-grid">
              {skillCommands.map(skill => (
                <div key={skill.name} className="sw-panel-skill-cell">
                  <span className="sw-section-label">{skill.name}</span>
                  <div className="sw-panel-skill-agents">
                    {(['claude', 'codex', 'gemini', 'cursor'] as PromptPackAgentType[]).map(agent => (
                      <span
                        key={agent}
                        className={`sw-dot ${
                          skill.agents[agent]?.installed
                            ? 'running'
                            : skill.agents[agent]?.supported
                              ? 'pending'
                              : 'idle'
                        }`}
                        title={`${agent}: ${
                          skill.agents[agent]?.installed
                            ? 'installed'
                            : skill.agents[agent]?.supported
                              ? 'available'
                              : 'unsupported'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="sw-panel-section">
          <div className="sw-panel-section-head">Context Bus</div>
          <WorkspaceConfigSection
            workspaceConfig={workspaceConfig}
            workspaceConfigLoaded={workspaceConfigLoaded}
            workspaceConfigExists={workspaceConfigExists}
            emptyMessage={
              userConfigExists
                ? 'No workspace .agents config found. Using ~/.agents defaults.'
                : 'No .agents config found. Initialize to configure context file symlinks.'
            }
            emptySecondaryMessage={
              userConfigExists
                ? 'Initialize a workspace config to override user defaults here.'
                : undefined
            }
            onInitWorkspaceConfig={onInitWorkspaceConfig}
            onSaveWorkspaceConfig={onSaveWorkspaceConfig}
          />
        </section>
      </div>
    </div>
  )
}
