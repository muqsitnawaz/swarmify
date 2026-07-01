// Consolidated Dispatch panel — replaces the 5 legacy dispatch surfaces.
// Presentational + local state only; data + actions arrive via DispatchPanelProps.
// Matches extension/docs/prototypes/dispatch.html 1:1 (layout, class names,
// interactions). The prototype's `S` object is mirrored in local state; `render()`
// becomes this component tree; the sub-renderers are the imported sub-components.
import React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { Bell, useClickAway } from './dispatchIcons'
import { DispatchInput, ticketKey } from './dispatchInput'
import { AgentSelect } from './AgentSelect'
import { HostSelect, suggestedHost } from './HostSelect'
import { ProjectSelect } from './ProjectSelect'
import { ModeSeg } from './ModeSeg'
import { WatchdogSeg } from './WatchdogSeg'
import { NotifyBell } from './NotifyBell'
import { BatchToggle } from './BatchToggle'
import type { UnifiedTask } from '../../types'
import type {
  InstalledAgent, DispatchHost, DispatchTarget, DispatchRequest,
  DispatchAttachment, DispatchMode, WatchdogPolicy, NotifyPrefs,
} from './dispatch.types'

export interface DispatchPanelProps {
  open: boolean
  tasks: UnifiedTask[]                 // backlog, for ticket attach + suggestions
  agents: InstalledAgent[]             // from `dispatchData` / agentInventories
  hosts: DispatchHost[]                // from `hostSessions` (widened with load)
  targets: DispatchTarget[]            // ranked projects (local) / repos (cloud)
  prefill?: string                     // seed the context box (⌘K / drag-drop)
  prefillTicketId?: string             // pre-attach a ticket (from backlog)
  onClose: () => void
  onDispatch: (req: DispatchRequest) => void
}

interface PanelState {
  prompt: string
  attached: string[]
  attachments: DispatchAttachment[]
  agent: string
  host: string
  project: string
  repo: string
  mode: DispatchMode
  watchdog: WatchdogPolicy
  expanded: boolean
  batch: 'all' | 'per'
  branch: string
  notify: NotifyPrefs
}

const DEFAULT_NOTIFY: NotifyPrefs = {
  events: { stall: true, question: true, plan: true, finish: true, fail: true },
  channel: 'imessage',
  dnd: false,
}

function initialState(prefill?: string, prefillTicketId?: string): PanelState {
  return {
    prompt: prefill ?? '',
    attached: prefillTicketId ? [prefillTicketId] : [],
    attachments: [],
    agent: '',            // '' -> effective fallback at render (default/signed-in agent)
    host: '',             // '' -> effective fallback (most-used online machine)
    project: '',
    repo: '',
    mode: 'auto',         // locked default
    watchdog: 'keep',
    expanded: false,
    batch: 'all',
    branch: 'auto (new branch)',
    notify: DEFAULT_NOTIFY,
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Local projects carry a `path`; cloud repos don't (dispatch.types contract). */
const isRepo = (t: DispatchTarget) => t.path === undefined

export function DispatchPanel(props: DispatchPanelProps) {
  const { open, tasks, agents, hosts, targets, prefill, prefillTicketId, onClose, onDispatch } = props
  const [S, setS] = useState<PanelState>(() => initialState(prefill, prefillTicketId))
  const [bellOpen, setBellOpen] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const bellRef = useRef<HTMLSpanElement>(null)
  useClickAway(bellRef, () => setBellOpen(false), bellOpen)

  // Re-seed + autofocus each time the panel opens.
  useEffect(() => {
    if (!open) return
    setS(initialState(prefill, prefillTicketId))
    setBellOpen(false)
    const id = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const patch = (p: Partial<PanelState>) => setS(s => ({ ...s, ...p }))

  // ---- effective selections (fall back to sensible defaults if state is unset or
  //      the chosen id vanished from freshly-loaded props) ----
  const effAgent =
    agents.find(a => a.id === S.agent)
    ?? agents.find(a => a.isDefault)
    ?? agents.find(a => a.signedIn)
    ?? agents[0]

  const mostUsedMachine = [...hosts].filter(h => h.kind !== 'cloud').sort((a, b) => b.uses - a.uses)[0]
  const effHost =
    hosts.find(h => h.id === S.host)
    ?? mostUsedMachine
    ?? suggestedHost(hosts)
    ?? hosts[0]
  const isCloud = effHost?.kind === 'cloud'

  const projects = targets.filter(t => !isRepo(t))
  const repos = targets.filter(isRepo)
  const topBy = (arr: DispatchTarget[]) => [...arr].sort((a, b) => b.uses - a.uses)[0]
  const effProject = projects.find(p => p.id === S.project) ?? topBy(projects)
  const effRepo = repos.find(r => r.id === S.repo) ?? topBy(repos)
  const projectLabel = isCloud ? (effRepo?.label ?? '—') : (effProject?.label ?? '—')

  const attachedCount = S.attached.length
  const bellActive = Object.values(S.notify.events).some(v => !v) || S.notify.dnd

  const doDispatch = () => {
    if (!effAgent || !effHost) return
    const req: DispatchRequest = {
      prompt: S.prompt,
      ticketIds: S.attached,
      attachments: S.attachments,
      agent: effAgent.id,
      runOn: effHost.id,
      project: isCloud ? undefined : effProject?.id,
      repo: isCloud ? effRepo?.id : undefined,
      branch: isCloud ? S.branch : undefined,
      mode: S.mode,
      watchdog: S.watchdog,
      notify: S.notify,
      batch: S.batch,
    }
    onDispatch(req)
  }

  // ---- header ----
  const phsub = attachedCount
    ? `${attachedCount} ticket${attachedCount > 1 ? 's' : ''} + context`
    : 'new agent'

  // ---- footer label ----
  const nCount = (S.batch === 'per' && attachedCount >= 2) ? attachedCount : 1
  const footLabel = nCount > 1
    ? `Dispatch ${nCount} agents`
    : `Dispatch ${effAgent?.name ?? 'agent'} → ${projectLabel}${S.mode !== 'auto' ? ' · ' + cap(S.mode) : ''}`

  return (
    <div className="dispatch-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className={`panel${bellOpen ? ' bell' : ''}`} onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
      <div className="ph">
        <span className="t">DISPATCH</span>
        <span className="sub">{phsub}</span>
        <span className="sp" />
        <span
          ref={bellRef}
          className={`icon ${bellActive ? 'act' : ''}`}
          title="Notifications"
          onClick={e => { e.stopPropagation(); setBellOpen(o => !o) }}
        >
          <Bell size={15} />
          <span className="belldot" />
        </span>
        <span className="icon" onClick={onClose}><Icon name="x" size={15} /></span>
      </div>

      <div className="body">
        <DispatchInput
          prompt={S.prompt}
          onPromptChange={v => patch({ prompt: v })}
          attached={S.attached}
          tasks={tasks}
          onAddTicket={k => patch({ attached: S.attached.includes(k) ? S.attached : [...S.attached, k] })}
          onRemoveTicket={k => patch({ attached: S.attached.filter(v => v !== k) })}
          attachments={S.attachments}
          onAddAttachment={a => patch({ attachments: [...S.attachments, a] })}
          onRemoveAttachment={i => patch({ attachments: S.attachments.filter((_, idx) => idx !== i) })}
          onSubmit={doDispatch}
          inputRef={inputRef}
        />

        {S.expanded ? (
          <div className="rows">
            <div className="row">
              <span className="lbl">Agent</span>
              <span className="ctl">
                <AgentSelect agents={agents} value={effAgent?.id ?? ''} onChange={id => patch({ agent: id })} />
              </span>
            </div>
            <div className="row">
              <span className="lbl">Run on</span>
              <span className="ctl">
                <HostSelect hosts={hosts} value={effHost?.id ?? ''} onChange={id => patch({ host: id })} />
              </span>
            </div>
            <div className="row">
              <span className="lbl">{isCloud ? 'Repo' : 'Project'}</span>
              <span className="ctl">
                <ProjectSelect
                  items={isCloud ? repos : projects}
                  value={(isCloud ? effRepo?.id : effProject?.id) ?? ''}
                  cloud={isCloud}
                  onChange={id => (isCloud ? patch({ repo: id }) : patch({ project: id }))}
                />
              </span>
            </div>
            <div className="row">
              <span className="lbl">Mode</span>
              <span className="ctl"><ModeSeg value={S.mode} onChange={m => patch({ mode: m })} /></span>
            </div>
            <div className="row">
              <span className="lbl">Watchdog</span>
              <span className="ctl"><WatchdogSeg value={S.watchdog} onChange={w => patch({ watchdog: w })} /></span>
            </div>
            <AdvancedOptions
              cloud={isCloud}
              branch={S.branch}
              onBranchChange={b => patch({ branch: b })}
            />
            <div className="collapse" onClick={() => patch({ expanded: false })}>
              <Icon name="chevD" size={12} /> Hide config
            </div>
          </div>
        ) : (
          <div className="summary" onClick={() => patch({ expanded: true })}>
            <span className="dot" />
            <span className="txt">
              <b>{effAgent?.name ?? 'agent'}</b> · {projectLabel} on {effHost?.label ?? '—'} · {cap(S.mode)}
            </span>
            <span className="cfg">Configure <Icon name="chevD" size={12} /></span>
          </div>
        )}

        {attachedCount >= 2 && (
          <BatchToggle count={attachedCount} value={S.batch} onChange={b => patch({ batch: b })} />
        )}
      </div>

      <div className="foot">
        <button className="disp" onClick={doDispatch}>
          <Icon name="zap" size={14} /> {footLabel}<span className="kbd">⌘↵</span>
        </button>
        {effAgent && !effAgent.signedIn && (
          <div className="warn">
            <Icon name="alert" size={13} />
            <span>{effAgent.name} isn&apos;t signed in — you&apos;ll be prompted to <b>agents add {effAgent.id}</b> first.</span>
          </div>
        )}
      </div>

      <NotifyBell prefs={S.notify} onChange={n => patch({ notify: n })} />
    </div>
    </div>
  )
}

// "More options" disclosure — Branch (cloud only) + the extra-context input. The
// extra-context field has no field in DispatchRequest yet (see report); it renders
// to match the prototype but is not wired into the emitted request.
function AdvancedOptions({ cloud, branch, onBranchChange }: {
  cloud: boolean
  branch: string
  onBranchChange: (b: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`adv ${open ? 'open' : ''}`}>
      <div className="adv-h" onClick={() => setOpen(o => !o)}>
        <span className="c"><Icon name="chevR" size={11} /></span> More options
      </div>
      <div className="adv-body">
        {cloud && (
          <div className="field">
            <div className="k">Branch</div>
            <input value={branch} onChange={e => onBranchChange(e.target.value)} />
          </div>
        )}
        <div className="field">
          <div className="k">Repos / extra context passed to the agent</div>
          <input placeholder="optional" />
        </div>
      </div>
    </div>
  )
}
