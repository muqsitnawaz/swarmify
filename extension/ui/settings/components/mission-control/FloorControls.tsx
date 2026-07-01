import React from 'react'
import { Icon } from './icons'
import type { AgentAbbr, FloorGroupBy, FloorSort } from './floorModel'

// Top bar (Finder-style view switcher + Group-by + stats + Plain-language toggle +
// sidebar/right toggles) and the filter bar (Sort, status/type chips, search, Dispatch).
// Prototype markup: factory-floor.html:260-306. Chrome SVGs are copied verbatim from the
// prototype so they match 1:1; status glyphs are rendered as CSS dots / icons, never emoji.

/** The Feed view is the port's primary target; the others route to existing views. */
export type FloorView = 'feed' | 'rail' | 'table' | 'board'
export type StatusChip = 'needs' | 'running' | 'idle' | 'failed'

const GROUP_OPTS: { value: FloorGroupBy; label: string }[] = [
  { value: 'host', label: 'Group: Host' },
  { value: 'project', label: 'Group: Project' },
  { value: 'status', label: 'Group: Status' },
  { value: 'agent', label: 'Group: Agent' },
]

const SORT_OPTS: { value: FloorSort; label: string }[] = [
  { value: 'needs', label: 'Needs you first' },
  { value: 'recent', label: 'Recent activity' },
  { value: 'tok', label: 'tok/s' },
  { value: 'name', label: 'Name' },
]

const DEFAULT_AGENT_CHIPS: AgentAbbr[] = ['CC', 'CX', 'GX']

const SVG = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 } as const

function ViewIcon({ view }: { view: FloorView }) {
  switch (view) {
    case 'feed':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" {...SVG}>
          <rect x="2" y="2.7" width="12" height="4.4" rx="1.2" />
          <rect x="2" y="8.9" width="12" height="4.4" rx="1.2" />
        </svg>
      )
    case 'rail':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" {...SVG}>
          <rect x="2.2" y="2.5" width="11.6" height="11" rx="1.4" />
          <line x1="6.6" y1="2.5" x2="6.6" y2="13.5" />
        </svg>
      )
    case 'table':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" {...SVG}>
          <circle cx="3.2" cy="4" r=".95" /><line x1="5.6" y1="4" x2="13.5" y2="4" />
          <circle cx="3.2" cy="8" r=".95" /><line x1="5.6" y1="8" x2="13.5" y2="8" />
          <circle cx="3.2" cy="12" r=".95" /><line x1="5.6" y1="12" x2="13.5" y2="12" />
        </svg>
      )
    case 'board':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" {...SVG}>
          <rect x="2.2" y="2.7" width="3" height="10.6" rx="1" />
          <rect x="6.5" y="2.7" width="3" height="7" rx="1" />
          <rect x="10.8" y="2.7" width="3" height="10.6" rx="1" />
        </svg>
      )
  }
}

const VIEW_TITLES: Record<FloorView, string> = {
  feed: 'Feed — live stream of every agent',
  rail: 'Columns — sidebar + detail',
  table: 'List — dense, sortable',
  board: 'Board — by status',
}

interface FloorControlsProps {
  view: FloorView
  onView: (v: FloorView) => void
  groupBy: FloorGroupBy
  onGroupBy: (g: FloorGroupBy) => void

  runningCount: number
  totalCount: number
  totalTok: number

  sidebarOpen: boolean
  onToggleSidebar: () => void
  rightOpen: boolean
  onToggleRight: () => void
  plain: boolean
  onTogglePlain: () => void
  onToggleTheme: () => void

  sort: FloorSort
  onSort: (s: FloorSort) => void
  /** Which status chips are active. */
  activeStatus: StatusChip[]
  onToggleStatus: (chip: StatusChip) => void
  /** Which agent-type chips to show (defaults to CC/CX/GX like the prototype). */
  agentChips?: AgentAbbr[]
  /** Which agent-type chips are active. */
  activeAbbrs: AgentAbbr[]
  onToggleAbbr: (abbr: AgentAbbr) => void

  search: string
  onSearch: (q: string) => void
  onDispatch: () => void
}

export function FloorControls({
  view, onView, groupBy, onGroupBy,
  runningCount, totalCount, totalTok,
  sidebarOpen, onToggleSidebar, rightOpen, onToggleRight, plain, onTogglePlain, onToggleTheme,
  sort, onSort, activeStatus, onToggleStatus, agentChips = DEFAULT_AGENT_CHIPS, activeAbbrs, onToggleAbbr,
  search, onSearch, onDispatch,
}: FloorControlsProps) {
  const views: FloorView[] = ['feed', 'rail', 'table', 'board']
  const statusOn = new Set(activeStatus)
  const abbrOn = new Set(activeAbbrs)

  return (
    <>
      <div className="top">
        <div className="logo"><span className="bolt"><Icon name="zap" size={14} /></span> FACTORY</div>
        <button
          className={`iconbtn ${sidebarOpen ? 'on' : ''}`}
          title="Show / hide projects sidebar"
          onClick={onToggleSidebar}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" {...SVG}>
            <rect x="2.2" y="2.5" width="11.6" height="11" rx="1.4" />
            <line x1="6" y1="2.5" x2="6" y2="13.5" />
          </svg>
        </button>
        <div className="viewbar">
          {views.map((v) => (
            <button key={v} className={view === v ? 'on' : ''} title={VIEW_TITLES[v]} onClick={() => onView(v)}>
              <ViewIcon view={v} />
            </button>
          ))}
        </div>
        <div className="arrange">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="4" cy="4" r="1.4" /><circle cx="8" cy="4" r="1.4" /><circle cx="12" cy="4" r="1.4" />
            <circle cx="4" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="12" cy="8" r="1.4" />
          </svg>
          <select value={groupBy} title="Arrange agents by" onChange={(e) => onGroupBy(e.target.value as FloorGroupBy)}>
            {GROUP_OPTS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="grow" />
        <div className="stat"><span className="dot running" /><b>{runningCount}</b>/<span>{totalCount}</span> running</div>
        <div className="stat tok"><Icon name="zap" size={12} /> <span>{totalTok.toLocaleString()}</span> tok/s</div>
        <button className="themebtn" onClick={onTogglePlain}>Plain language: {plain ? 'on' : 'off'}</button>
        <button
          className={`iconbtn ${rightOpen ? 'on' : ''}`}
          title="Show / hide the detail panel"
          onClick={onToggleRight}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" {...SVG}>
            <rect x="2.2" y="2.5" width="11.6" height="11" rx="1.4" />
            <line x1="10" y1="2.5" x2="10" y2="13.5" />
          </svg>
        </button>
        <button className="themebtn" onClick={onToggleTheme}><Icon name="moon" size={12} /> theme</button>
      </div>

      <div className="fbar">
        <div className="ctl">
          Sort{' '}
          <select className="sel" value={sort} onChange={(e) => onSort(e.target.value as FloorSort)}>
            {SORT_OPTS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <span className={`chip needs ${statusOn.has('needs') ? 'on' : ''}`} onClick={() => onToggleStatus('needs')}>
          <Icon name="alert" size={11} /> Needs you
        </span>
        <span className={`chip ${statusOn.has('running') ? 'on' : ''}`} onClick={() => onToggleStatus('running')}>
          <span className="dot running" /> Running
        </span>
        <span className={`chip ${statusOn.has('idle') ? 'on' : ''}`} onClick={() => onToggleStatus('idle')}>
          <span className="dot idle" /> Idle
        </span>
        <span className={`chip ${statusOn.has('failed') ? 'on' : ''}`} onClick={() => onToggleStatus('failed')}>
          <span className="dot failed" /> Failed
        </span>
        {agentChips.map((ab) => (
          <span key={ab} className={`chip ${abbrOn.has(ab) ? 'on' : ''}`} onClick={() => onToggleAbbr(ab)}>{ab}</span>
        ))}
        <input
          className="search"
          placeholder="search agents, branches, activity…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
        <div className="grow" />
        <button className="disp" onClick={onDispatch}><Icon name="zap" size={12} /> Dispatch</button>
      </div>
    </>
  )
}
