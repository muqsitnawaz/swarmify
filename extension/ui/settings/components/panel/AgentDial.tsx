import React from 'react'

export interface AgentDialOption {
  key: string
  label: string
  caption?: string
  disabled?: boolean
}

export interface AgentDialMeta {
  version?: string
  model?: string
  account?: string
  plan?: string
  running?: number
  lastActive?: string
  sessions?: number
  skillsInstalled?: number
  skillsTotal?: number
}

interface AgentDialProps {
  title: string
  value: string
  options: AgentDialOption[]
  onChange: (key: string) => void
  meta?: AgentDialMeta
  shortcut?: string
}

function MiniVU({ level, max = 8 }: { level: number; max?: number }) {
  const segments = Array.from({ length: max }, (_, i) => {
    const active = i < level
    const zone = i < max * 0.6 ? 'green' : i < max * 0.85 ? 'amber' : 'red'
    return (
      <div
        key={i}
        className={`sw-vu-seg ${active ? zone : 'off'}`}
      />
    )
  })
  return <div className="sw-vu-bar">{segments}</div>
}

export function AgentDial({ title, value, options, onChange, meta, shortcut }: AgentDialProps) {
  const selected = options.find(option => option.key === value) ?? options[0]
  const selectedIndex = options.findIndex(option => option.key === value)
  const pointerAngle = selectedIndex >= 0 ? -90 + (360 / options.length) * selectedIndex : -90

  return (
    <section className="sw-panel-section sw-agent-dial-card">
      <div className="sw-panel-section-head">
        {title}
        {shortcut && (
          <span className="kbd-group" style={{ marginLeft: 'auto' }}>
            {shortcut.split('+').map(k => <span key={k} className="kbd kbd-inline">{k}</span>)}
          </span>
        )}
      </div>
      <div className="sw-agent-dial">
        <div className="sw-agent-dial-ring">
          {options.map((option, index) => {
            const angle = (-90 + (360 / options.length) * index) * (Math.PI / 180)
            const radius = 72
            const x = Math.cos(angle) * radius
            const y = Math.sin(angle) * radius
            return (
              <button
                key={option.key}
                type="button"
                className={`sw-agent-dial-stop${option.key === value ? ' active' : ''}`}
                style={{
                  left: `calc(50% + ${x}px)`,
                  top: `calc(50% + ${y}px)`,
                }}
                disabled={option.disabled}
                onClick={() => onChange(option.key)}
                aria-pressed={option.key === value}
              >
                <span className="sw-agent-dial-stop-label">{option.label}</span>
              </button>
            )
          })}
          <div className="sw-agent-dial-core" style={{ transform: `rotate(${pointerAngle + 90}deg)`, transition: 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
            <div className="sw-agent-dial-core-cap" />
            <div className="sw-agent-dial-pointer" />
          </div>
        </div>
      </div>

      {meta && (
        <div className="sw-dial-deck">
          <div className="sw-dial-deck-row">
            <span className="sw-dial-deck-label">Model</span>
            <span className="sw-dial-deck-value glow">{meta.model || 'auto'}</span>
          </div>
          {meta.version && (
            <div className="sw-dial-deck-row">
              <span className="sw-dial-deck-label">Version</span>
              <span className="sw-dial-deck-value">{meta.version}</span>
            </div>
          )}
          {meta.account && (
            <div className="sw-dial-deck-row">
              <span className="sw-dial-deck-label">Account</span>
              <span className="sw-dial-deck-value">{meta.account}</span>
            </div>
          )}
          {meta.plan && (
            <div className="sw-dial-deck-row">
              <span className="sw-dial-deck-label">Plan</span>
              <span className="sw-dial-deck-value">{meta.plan}</span>
            </div>
          )}
          <div className="sw-dial-deck-meters">
            <div className="sw-dial-deck-meter">
              <span className="sw-dial-deck-label">Active</span>
              <MiniVU level={meta.running ?? 0} max={6} />
              <span className="sw-dial-deck-value">{meta.running ?? 0}</span>
            </div>
            {meta.skillsTotal != null && meta.skillsTotal > 0 && (
              <div className="sw-dial-deck-meter">
                <span className="sw-dial-deck-label">Skills</span>
                <MiniVU level={meta.skillsInstalled ?? 0} max={meta.skillsTotal} />
                <span className="sw-dial-deck-value">{meta.skillsInstalled}/{meta.skillsTotal}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="sw-agent-dial-readout sw-readout">
        <span className="sw-agent-dial-selected">{selected?.label ?? 'N/A'}</span>
        <span>{selected?.caption ?? 'Standby route'}</span>
      </div>
    </section>
  )
}
