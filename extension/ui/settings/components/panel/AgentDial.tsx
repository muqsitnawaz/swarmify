import React from 'react'

export interface AgentDialOption {
  key: string
  label: string
  caption?: string
  disabled?: boolean
}

interface AgentDialProps {
  title: string
  value: string
  options: AgentDialOption[]
  onChange: (key: string) => void
}

export function AgentDial({ title, value, options, onChange }: AgentDialProps) {
  const selected = options.find(option => option.key === value) ?? options[0]

  return (
    <section className="sw-panel-section sw-agent-dial-card">
      <div className="sw-panel-section-head">{title}</div>
      <div className="sw-agent-dial">
        <div className="sw-agent-dial-ring">
          {options.map((option, index) => {
            const angle = (-90 + (360 / options.length) * index) * (Math.PI / 180)
            const radius = 88
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
          <div className="sw-agent-dial-core">
            <div className="sw-agent-dial-core-cap" />
            <div className="sw-agent-dial-pointer" />
          </div>
        </div>
        <div className="sw-agent-dial-readout sw-readout">
          <span className="sw-agent-dial-selected">{selected?.label ?? 'N/A'}</span>
          <span>{selected?.caption ?? 'Standby route'}</span>
        </div>
      </div>
    </section>
  )
}
