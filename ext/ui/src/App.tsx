import { useState, useEffect } from 'react'
import { Button } from './components/ui/button'
import { Checkbox } from './components/ui/checkbox'
import { Input } from './components/ui/input'
import { Trash2, Plus, X } from 'lucide-react'

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

type SwarmAgentType = 'cursor' | 'codex' | 'claude' | 'gemini'
const ALL_SWARM_AGENTS: SwarmAgentType[] = ['cursor', 'codex', 'claude', 'gemini']

interface AgentSettings {
  builtIn: {
    claude: BuiltInAgentSettings
    codex: BuiltInAgentSettings
    gemini: BuiltInAgentSettings
    cursor: BuiltInAgentSettings
  }
  custom: CustomAgentSettings[]
  swarmEnabledAgents: SwarmAgentType[]
}

interface RunningCounts {
  claude: number
  codex: number
  gemini: number
  cursor: number
  custom: Record<string, number>
}

interface SwarmStatus {
  mcpEnabled: boolean
  commandInstalled: boolean
}

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
      cursor: string
      agents: string
    }
  }
}

const vscode = acquireVsCodeApi()
const icons = window.__ICONS__

const BUILT_IN_AGENTS = [
  { key: 'claude', name: 'Claude', icon: icons.claude },
  { key: 'codex', name: 'Codex', icon: icons.codex },
  { key: 'gemini', name: 'Gemini', icon: icons.gemini },
  { key: 'cursor', name: 'Cursor', icon: icons.cursor },
  { key: 'shell', name: 'Shell', icon: icons.shell },
] as const

const RESERVED_NAMES = ['CC', 'CX', 'GX', 'CR', 'SH']

export default function App() {
  const [settings, setSettings] = useState<AgentSettings | null>(null)
  const [runningCounts, setRunningCounts] = useState<RunningCounts>({
    claude: 0, codex: 0, gemini: 0, cursor: 0, custom: {}
  })
  const [swarmStatus, setSwarmStatus] = useState<SwarmStatus>({
    mcpEnabled: false, commandInstalled: false
  })
  const [isAdding, setIsAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCommand, setNewCommand] = useState('')
  const [nameError, setNameError] = useState('')

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
      }
    }

    window.addEventListener('message', handleMessage)
    vscode.postMessage({ type: 'ready' })

    return () => window.removeEventListener('message', handleMessage)
  }, [])

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

  if (!settings) {
    return <div className="text-[var(--muted-foreground)]">Loading...</div>
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <header className="flex items-center justify-between pb-6 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <img src={icons.agents} alt="Agents" className="w-10 h-10" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Agents</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              Manage your AI coding agents
            </p>
          </div>
        </div>
      </header>

      {/* Swarm Integration */}
      <section>
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)] mb-4">
          Swarm Integration
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
          Swarm Agents
        </h2>
        <div className="flex flex-wrap gap-3">
          {(['cursor', 'codex', 'claude', 'gemini'] as SwarmAgentType[]).map(agent => (
            <div key={agent} className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-[var(--muted)]">
              <Checkbox
                checked={isSwarmAgentEnabled(agent)}
                onCheckedChange={(checked) => toggleSwarmAgent(agent, !!checked)}
              />
              <span className="text-sm font-medium capitalize">{agent}</span>
            </div>
          ))}
        </div>
      </section>

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

      {/* Agents */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
            Agents
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
          {/* Built-in agents */}
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
                  <label className="text-sm text-[var(--muted-foreground)]">Login</label>
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

          {/* Custom agents */}
          {settings.custom.map((agent, index) => (
            <div key={index} className="flex items-center gap-4 px-4 py-3 rounded-xl bg-[var(--muted)]">
              <img src={icons.agents} alt={agent.name} className="w-5 h-5" />
              <span className="text-sm font-medium w-20">{agent.name}</span>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={agent.login}
                  onCheckedChange={(checked) => updateCustom(index, 'login', !!checked)}
                />
                <label className="text-sm text-[var(--muted-foreground)]">Login</label>
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

          {/* Inline add row */}
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

      {/* Shortcuts */}
      <section>
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)] mb-4">
          Shortcuts
        </h2>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-4">
            <kbd className="px-2 py-1 rounded bg-[var(--secondary)] text-[var(--muted-foreground)] font-mono text-xs">Cmd+Shift+A</kbd>
            <span className="text-[var(--muted-foreground)]">New agent</span>
          </div>
          <div className="flex items-center gap-4">
            <kbd className="px-2 py-1 rounded bg-[var(--secondary)] text-[var(--muted-foreground)] font-mono text-xs">Cmd+Shift+L</kbd>
            <span className="text-[var(--muted-foreground)]">Label agent</span>
          </div>
          <div className="flex items-center gap-4">
            <kbd className="px-2 py-1 rounded bg-[var(--secondary)] text-[var(--muted-foreground)] font-mono text-xs">Cmd+Shift+G</kbd>
            <span className="text-[var(--muted-foreground)]">Commit & push</span>
          </div>
          <div className="flex items-center gap-4">
            <kbd className="px-2 py-1 rounded bg-[var(--secondary)] text-[var(--muted-foreground)] font-mono text-xs">Cmd+Shift+C</kbd>
            <span className="text-[var(--muted-foreground)]">Clear & restart</span>
          </div>
        </div>
      </section>
    </div>
  )
}
