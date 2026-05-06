import React from 'react'
import type { AgentInventory } from '../../types'

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
  inventory?: AgentInventory
  onToggleRotation?: (enabled: boolean) => void
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

function usageLabel(status: AgentInventory['versions'][number]['usageStatus']): string {
  if (status === 'available') return 'Healthy'
  if (status === 'rate_limited') return 'Rate limited'
  if (status === 'out_of_credits') return 'Out of credits'
  return 'Unknown'
}

export function AgentDial({ title, value, options, onChange, meta, shortcut, inventory, onToggleRotation }: AgentDialProps) {
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
          {inventory && (
            <div className="sw-dial-inventory">
              <div className="sw-dial-deck-row">
                <span className="sw-dial-deck-label">Route</span>
                <span className="sw-dial-deck-value">
                  {inventory.strategy === 'rotate' ? 'Rotate healthy accounts' : inventory.strategy}
                </span>
              </div>
              <div className="sw-dial-deck-row">
                <span className="sw-dial-deck-label">Accounts</span>
                <span className="sw-dial-deck-value">
                  {inventory.signedInCount} signed in, {inventory.healthyCount} healthy
                </span>
              </div>
              {onToggleRotation && (
                <div className="sw-dial-toggle-row">
                  <span className="sw-dial-deck-label">Rotation</span>
                  <div className="sw-dial-toggle-wrap">
                    <span className="sw-dial-deck-value">
                      {inventory.strategy === 'rotate' ? 'On' : 'Off'}
                    </span>
                    <button
                      type="button"
                      className="toggle-switch"
                      data-state={inventory.strategy === 'rotate' ? 'on' : 'off'}
                      role="switch"
                      aria-checked={inventory.strategy === 'rotate'}
                      onClick={() => onToggleRotation(inventory.strategy !== 'rotate')}
                    >
                      <span className="toggle-knob" />
                    </button>
                  </div>
                </div>
              )}
              <div className="sw-dial-version-list">
                {inventory.versions.slice(0, 4).map((version) => (
                  <div key={version.version} className="sw-dial-version-line">
                    <div className="sw-dial-version-left">
                      <span className="sw-dial-deck-value">
                        {version.version}{version.isDefault ? ' default' : ''}
                      </span>
                      <span className="sw-dial-deck-label">
                        {version.email || 'Signed out'}
                      </span>
                    </div>
                    <div className="sw-dial-version-right">
                      <span className="sw-dial-deck-value">{usageLabel(version.usageStatus)}</span>
                      <span className="sw-dial-deck-label">{version.sessionUsedPercent}% used</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="sw-agent-dial-readout sw-readout">
        <span className="sw-agent-dial-selected">{selected?.label ?? 'N/A'}</span>
        <span>{selected?.caption ?? 'Standby route'}</span>
      </div>
    </section>
  )
}
