import React from 'react'
import { Icon } from './icons'
import { StructuredReply, type ReplyCallbacks } from './StructuredReply'
import { heartbeatLevel, type FloorAgent, type FloorTicket } from './floorModel'
import { sinceFromMs } from './floorAdapter'
import { useNow } from './useNow'

// One agent row in the feed (feedItem: factory-floor.html:608-620) + the Next-Up
// ticketStrip teaser row (:621-623). Pure presentation; selection + replies raised
// via callbacks.

/** Qualitative throughput when plain, raw tok/s otherwise. Prototype plainTok():400. */
function plainTok(tok: number, plain: boolean): string {
  if (plain) return tok > 120 ? 'fast' : tok > 0 ? 'working' : ''
  return tok ? `${tok} tok/s` : ''
}

interface FeedItemProps extends ReplyCallbacks {
  agent: FloorAgent
  selected: boolean
  plain: boolean
  /** The row (not the reply controls) was clicked. */
  onSelect: (id: string) => void
}

export function FeedItem({ agent: a, selected, plain, onSelect, onOption, onFreeText, onAttach }: FeedItemProps) {
  // Live heartbeat: only a running / stalled agent with a known last-activity stamp ticks.
  // The shared 1s ticker re-renders just this leaf, never the parent list.
  const now = useNow(1000)
  const beats = a.lastActivityMs > 0 && (a.phase === 'running' || a.phase === 'stalled')
  const ageMs = beats ? Math.max(0, now - a.lastActivityMs) : NaN
  const level = beats ? heartbeatLevel(ageMs) : 'live'
  const stalled = a.phase === 'stalled' || level !== 'live'
  const liveSince = beats ? sinceFromMs(ageMs) : a.since

  const tok = plainTok(a.tok, plain)
  const meta = plain ? a.project : `${a.project} · ${a.hostLabel ?? a.host}${a.ticket ? ` · ${a.ticket}` : ''}`
  const destructive = a.question?.kind === 'destructive'
  const attn = a.phase === 'failed' ? 'fail' : stalled ? 'stall' : a.needs ? 'attn' : ''

  const marker =
    a.pr ? <span className="pill pr">PR {a.pr}</span> :
    stalled ? <span className="pill stall">stalled</span> :
    a.phase === 'running' ? <span className="pill run">running</span> :
    a.phase === 'done' ? <span className="pill done">done</span> : null

  return (
    <div
      className={`fitem ${attn}${selected ? ' selsel' : ''}`}
      data-id={a.id}
      onClick={() => onSelect(a.id)}
    >
      <div className="head">
        <span className={`dot ${a.phase}`} />
        <span className={`av ${a.abbr}`}>{a.abbr}</span>
        <span className="who">{a.name}</span>
        <span className="path">{meta}</span>
        <span className="when">
          {marker}
          {tok && (
            <span className="tps">{!plain && <Icon name="zap" size={11} />}{tok}</span>
          )}
          <span className={`hb ${level}`}>
            {beats && <Icon name="clock" size={10} />}{liveSince} ago
          </span>
        </span>
      </div>
      <div className="resp">{destructive ? <span className="q">{a.resp}</span> : a.resp}</div>
      {!plain && (
        <div className={`nowline ${stalled ? 'stall' : ''}`}>
          <Icon name="chevR" size={11} /> <span className="v">{a.verb}</span> {a.target}
        </div>
      )}
      {a.needs && (
        <div onClick={(e) => e.stopPropagation()}>
          <StructuredReply
            question={a.question}
            phase={a.phase}
            onOption={onOption}
            onFreeText={onFreeText}
            onAttach={onAttach}
          />
        </div>
      )}
    </div>
  )
}

interface TicketStripProps {
  ticket: FloorTicket
  /** The Dispatch button was clicked. */
  onDispatch: (id: string) => void
  /** The row (not the Dispatch button) was clicked — open the ticket. */
  onSelect: (id: string) => void
}

// Next-Up backlog teaser row. Prototype ticketStrip(): factory-floor.html:621-623.
export function TicketStrip({ ticket: t, onDispatch, onSelect }: TicketStripProps) {
  return (
    <div className="trow" data-tid={t.id} onClick={() => onSelect(t.id)}>
      <span className={`pri ${t.pri}`} />
      <span className={`src ${t.source}`}>{t.source}</span>
      <span className="tid">{t.id}</span>
      <span className="tt">{t.title}</span>
      <button
        className="dispatch-sm"
        onClick={(e) => { e.stopPropagation(); onDispatch(t.id) }}
      >
        Dispatch <Icon name="chevR" size={10} />
      </button>
    </div>
  )
}
