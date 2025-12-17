import { useState, useEffect } from 'react'
import { Button } from './components/ui/button'
import { Checkbox } from './components/ui/checkbox'
import { Input } from './components/ui/input'
import { Trash2, Plus } from 'lucide-react'

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

interface AgentSettings {
  builtIn: {
    claude: BuiltInAgentSettings
    codex: BuiltInAgentSettings
    gemini: BuiltInAgentSettings
    cursor: BuiltInAgentSettings
  }
  custom: CustomAgentSettings[]
}

interface RunningCounts {
  claude: number
  codex: number
  gemini: number
  cursor: number
  custom: Record<string, number>
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
] as const

const RESERVED_NAMES = ['CC', 'CX', 'GX', 'CR']

export default function App() {
  const [settings, setSettings] = useState<AgentSettings | null>(null)
  const [runningCounts, setRunningCounts] = useState<RunningCounts>({
    claude: 0, codex: 0, gemini: 0, cursor: 0, custom: {}
  })
  const [newName, setNewName] = useState('')
  const [newCommand, setNewCommand] = useState('')
  const [nameError, setNameError] = useState('')

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data
      if (message.type === 'init') {
        setSettings(message.settings)
        setRunningCounts(message.runningCounts)
      } else if (message.type === 'updateRunningCounts') {
        setRunningCounts(message.counts)
      }
    }

    window.addEventListener('message', handleMessage)
    vscode.postMessage({ type: 'ready' })

    return () => window.removeEventListener('message', handleMessage)
  }, [])

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

  const validateName = (name: string): string => {
    const upper = name.toUpperCase()
    if (upper.length === 0) return ''
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

  const addCustomAgent = () => {
    if (!settings || !newName || !newCommand || nameError) return
    const newAgent: CustomAgentSettings = {
      name: newName.toUpperCase(),
      command: newCommand,
      login: false,
      instances: 1
    }
    saveSettings({ ...settings, custom: [...settings.custom, newAgent] })
    setNewName('')
    setNewCommand('')
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
      {/* Running Now */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-3">
          Running Now
        </h2>
        <div className="flex flex-wrap gap-4">
          {BUILT_IN_AGENTS.map(agent => (
            <div key={agent.key} className="flex items-center gap-2 px-3 py-2 rounded border border-[var(--border)] bg-[var(--muted)]">
              <img src={agent.icon} alt={agent.name} className="w-5 h-5" />
              <span className="text-sm">{agent.name}</span>
              <span className="text-lg font-semibold text-[var(--primary)]">
                {runningCounts[agent.key as keyof typeof runningCounts] as number}
              </span>
            </div>
          ))}
          {Object.entries(runningCounts.custom).map(([name, count]) => (
            <div key={name} className="flex items-center gap-2 px-3 py-2 rounded border border-[var(--border)] bg-[var(--muted)]">
              <img src={icons.agents} alt={name} className="w-5 h-5" />
              <span className="text-sm">{name}</span>
              <span className="text-lg font-semibold text-[var(--primary)]">{count}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Agents */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-3">
          Agents
        </h2>
        <div className="space-y-2">
          {/* Built-in agents */}
          {BUILT_IN_AGENTS.map(agent => {
            const config = settings.builtIn[agent.key as keyof AgentSettings['builtIn']]
            return (
              <div key={agent.key} className="flex items-center gap-4 px-3 py-2 rounded border border-[var(--border)] bg-[var(--muted)]">
                <img src={agent.icon} alt={agent.name} className="w-5 h-5" />
                <span className="text-sm font-medium w-20">{agent.name}</span>
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={config.login}
                    onCheckedChange={(checked) => updateBuiltIn(agent.key as keyof AgentSettings['builtIn'], 'login', !!checked)}
                  />
                  <label className="text-sm">Login</label>
                </div>
                {config.login && (
                  <div className="flex items-center gap-2 ml-4">
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      value={config.instances}
                      onChange={(e) => updateBuiltIn(agent.key as keyof AgentSettings['builtIn'], 'instances', Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                      className="w-16"
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
          {settings.custom.length > 0 && (
            <div className="border-t border-[var(--border)] my-4" />
          )}
          {settings.custom.map((agent, index) => (
            <div key={index} className="flex items-center gap-4 px-3 py-2 rounded border border-[var(--border)] bg-[var(--muted)]">
              <img src={icons.agents} alt={agent.name} className="w-5 h-5" />
              <span className="text-sm font-medium w-20">{agent.name}</span>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={agent.login}
                  onCheckedChange={(checked) => updateCustom(index, 'login', !!checked)}
                />
                <label className="text-sm">Login</label>
              </div>
              {agent.login && (
                <div className="flex items-center gap-2 ml-4">
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={agent.instances}
                    onChange={(e) => updateCustom(index, 'instances', Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                    className="w-16"
                  />
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {agent.instances === 1 ? 'instance' : 'instances'}
                  </span>
                </div>
              )}
              <div className="flex-1" />
              <Button variant="ghost" size="icon" onClick={() => removeCustomAgent(index)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}

          {/* Add custom agent */}
          <div className="flex items-center gap-2 mt-4">
            <Input
              placeholder="XX"
              value={newName}
              onChange={(e) => handleNameChange(e.target.value)}
              className="w-16 uppercase"
              maxLength={2}
            />
            <Input
              placeholder="command"
              value={newCommand}
              onChange={(e) => setNewCommand(e.target.value)}
              className="flex-1"
            />
            <Button
              onClick={addCustomAgent}
              disabled={!newName || !newCommand || !!nameError}
              size="sm"
            >
              <Plus className="w-4 h-4 mr-1" />
              Add
            </Button>
          </div>
          {nameError && (
            <p className="text-xs text-red-500 mt-1">{nameError}</p>
          )}
        </div>
      </section>
    </div>
  )
}
