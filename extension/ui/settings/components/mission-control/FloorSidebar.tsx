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
  /**
   * Scope routing. '' = All agents, '__needs' = Needs you, '__queue' = Backlog,
   * otherwise a project name. Mirrors wireSidebar()'s data-proj values.
   */
  onScope: (value: string) => void
}

export function FloorSidebar({ agents, tickets, projFilter, offlineHosts = [], onScope }: FloorSidebarProps) {
  const byProj: Record<string, number> = {}
  const byHost: Record<string, number> = {}
  const projWait: Record<string, number> = {}
  for (const a of agents) {
    byProj[a.project] = (byProj[a.project] || 0) + 1
    byHost[a.host] = (byHost[a.host] || 0) + 1
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
      {Object.keys(byHost).sort().map((ho) => (
        <div key={ho} className="sb-item" onClick={() => onScope('')}>
          <span className={`hd ${offline.has(ho) ? 'off' : ''}`} />
          <span>{ho}</span>
          <span className="c">{offline.has(ho) ? <span style={{ color: 'var(--fail)' }}>offline</span> : byHost[ho]}</span>
        </div>
      ))}
    </div>
  )
}
