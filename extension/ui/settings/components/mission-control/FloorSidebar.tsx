import React from 'react'
import { Icon } from './icons'
import type { FloorAgent, FloorTicket } from './floorModel'

// Left scope sidebar. Prototype buildSidebar(): factory-floor.html:563-579,
// wiring wireSidebar():580-588. Smart (All / Needs you), Queue (Backlog),
// Projects (with wait-counts), Hosts (with health). Counts are derived from the
// agents + tickets passed in — no data fetching here.

interface FloorSidebarProps {
  agents: FloorAgent[]
  tickets: FloorTicket[]
  /** Current project filter: null = All agents; a project name otherwise. */
  projFilter: string | null
  /** Hosts known to be offline (health comes from SHELL, not hardcoded). */
  offlineHosts?: string[]
  /** Registered device fleet (agents devices) to surface under HOSTS, even with 0 agents. */
  devices?: { name: string; online: boolean; agents: number }[]
  /**
   * Scope routing. '' = All agents, '__needs' = Needs you, '__queue' = Backlog,
   * otherwise a project name. Mirrors wireSidebar()'s data-proj values.
   */
  onScope: (value: string) => void
}

export function FloorSidebar({ agents, tickets, projFilter, offlineHosts = [], devices = [], onScope }: FloorSidebarProps) {
  const byProj: Record<string, number> = {}
  const byHost: Record<string, number> = {}
  const projWait: Record<string, number> = {}
  for (const a of agents) {
    byProj[a.project] = (byProj[a.project] || 0) + 1
    // Key by the DISPLAY name so the local machine's session bucket (host
    // 'this-mac') folds into its real device name (e.g. 'zion') and merges with
    // the registry entry below instead of rendering as a second, duplicate row.
    const hostKey = a.hostLabel ?? a.host
    byHost[hostKey] = (byHost[hostKey] || 0) + 1
    if (a.needs) projWait[a.project] = (projWait[a.project] || 0) + 1
  }
  const needs = agents.filter((a) => a.needs).length
  const offline = new Set(offlineHosts)

  return (
    <div className="sidebar">
      <div className="sb-sec">SMART</div>
      <div className={`sb-item ${projFilter === null ? 'on' : ''}`} onClick={() => onScope('')}>
        <span>All agents</span>
        <span className="c">{agents.length}</span>
      </div>
      <div className="sb-item" onClick={() => onScope('__needs')}>
        <span style={{ color: 'var(--wait)' }}><Icon name="alert" size={12} /> Needs you</span>
        <span className="c"><span className="w">{needs}</span></span>
      </div>

      <div className="sb-sec">QUEUE</div>
      <div className="sb-item" onClick={() => onScope('__queue')}>
        <span>Backlog</span>
        <span className="c">{tickets.length} tickets</span>
      </div>

      <div className="sb-sec">PROJECTS</div>
      {Object.keys(byProj).sort().map((p) => (
        <div key={p} className={`sb-item ${projFilter === p ? 'on' : ''}`} onClick={() => onScope(p)}>
          <span>{p}</span>
          <span className="c">
            {projWait[p] ? <span className="w"><Icon name="clock" size={10} />{projWait[p]}</span> : null}
            {byProj[p]}
          </span>
        </div>
      ))}

      <div className="sb-sec">HOSTS</div>
      {(() => {
        // Merge active-session hosts (byHost, local folded to its real device
        // name) with the online device fleet from `agents devices` so hosts show
        // even with 0 agents. Keys now agree, so the local machine renders once.
        const deviceByName = new Map(devices.map((d) => [d.name, d]))
        const names = new Set<string>(Object.keys(byHost))
        for (const d of devices) if (d.online) names.add(d.name)
        return [...names].sort().map((ho) => {
          const dev = deviceByName.get(ho)
          // Device-registry reachability (tailscale.online) is authoritative when a
          // fleet entry exists — a host can be online yet fail the session-fetch
          // (Windows shell, slow SSH, agents-cli hiccup), which must zero the count,
          // not flip the host to offline. Session-fetch reachability only decides
          // hosts with no device entry (SSH-config-only).
          const isOff = dev ? !dev.online : offline.has(ho)
          const count = byHost[ho] ?? dev?.agents ?? 0
          return (
            <div key={ho} className="sb-item" onClick={() => onScope('')}>
              <span className={`hd ${isOff ? 'off' : ''}`} />
              <span>{ho}</span>
              <span className="c">{isOff ? <span style={{ color: 'var(--fail)' }}>offline</span> : count}</span>
            </div>
          )
        })
      })()}
    </div>
  )
}
