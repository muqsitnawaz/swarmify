import React, { useEffect, useRef, useState } from 'react'

type ConnState = 'idle' | 'connecting' | 'connected' | 'closed' | 'error'
type Activity = 'idle' | 'listening' | 'speaking'
type VisualState = 'idle' | 'connecting' | 'listening' | 'speaking' | 'hibernating'

interface TranscriptLine {
  id: string
  role: 'user' | 'assistant'
  text: string
  final: boolean
}

interface ForemanOrbProps {
  vscode: {
    postMessage: (msg: any) => void
  }
}

const IDLE_CLOSE_MS = 60_000
const IDLE_WARN_MS = 50_000
const SPEAKING_DECAY_MS = 1_500
const TRANSCRIPT_WINDOW = 4

// Voice-abort keywords: when any of these appear as a completed user
// transcript, we dispatch foreman.abort so the ForemanCursor cancels any
// in-flight UI sequence. The realtime transcript is emitted with final=true
// at end of utterance, so this fires on completed words — not a partial.
const ABORT_PATTERN = /\b(stop|cancel|wait|nevermind|never mind|abort|no)\b/i

export function ForemanOrb({ vscode }: ForemanOrbProps) {
  const [conn, setConn] = useState<ConnState>('idle')
  const [activity, setActivity] = useState<Activity>('idle')
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
  const [idleCountdown, setIdleCountdown] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const lastActivityAt = useRef<number>(Date.now())
  const activityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idleTicker = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const m = event.data
      if (m?.type === 'foreman.status') {
        setConn(m.status)
        if (m.status === 'error') setError(m.detail ?? 'error')
        else if (m.status === 'connecting' || m.status === 'connected') setError(null)
        if (m.status === 'connected') lastActivityAt.current = Date.now()
      } else if (m?.type === 'foreman.transcript') {
        setTranscript((prev) => appendTranscript(prev, m.role, m.text, m.final))
        lastActivityAt.current = Date.now()
        setActivity(m.role === 'assistant' ? 'speaking' : 'listening')
        if (activityTimer.current) clearTimeout(activityTimer.current)
        activityTimer.current = setTimeout(() => setActivity('idle'), SPEAKING_DECAY_MS)

        // Voice-abort: final user utterance matching abort keywords cancels
        // any in-flight UI sequence (cursor animation, pending click, etc).
        if (m.role === 'user' && m.final && typeof m.text === 'string' && ABORT_PATTERN.test(m.text)) {
          window.postMessage({ type: 'foreman.abort' }, '*')
        }
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      vscode.postMessage({ type: 'foreman.stopSession' })
    }
  }, [])

  useEffect(() => {
    if (conn !== 'connected') {
      if (idleTicker.current) clearInterval(idleTicker.current)
      idleTicker.current = null
      setIdleCountdown(null)
      return
    }
    idleTicker.current = setInterval(() => {
      const elapsed = Date.now() - lastActivityAt.current
      if (elapsed >= IDLE_CLOSE_MS) {
        handleStop()
        return
      }
      if (elapsed >= IDLE_WARN_MS) {
        setIdleCountdown(Math.max(0, Math.ceil((IDLE_CLOSE_MS - elapsed) / 1000)))
      } else {
        setIdleCountdown(null)
      }
    }, 500)
    return () => {
      if (idleTicker.current) clearInterval(idleTicker.current)
      idleTicker.current = null
    }
  }, [conn])

  const handleStart = () => {
    setError(null)
    setTranscript([])
    setConn('connecting')
    lastActivityAt.current = Date.now()
    vscode.postMessage({ type: 'foreman.startSession' })
  }

  const handleStop = () => {
    vscode.postMessage({ type: 'foreman.stopSession' })
    setConn('closed')
    setIdleCountdown(null)
    setActivity('idle')
  }

  const handleOrbClick = () => {
    if (conn === 'connecting') return
    if (conn === 'connected') {
      if (idleCountdown !== null) {
        lastActivityAt.current = Date.now()
        setIdleCountdown(null)
        return
      }
      handleStop()
      return
    }
    handleStart()
  }

  const visualState: VisualState =
    conn === 'connecting' ? 'connecting' :
    conn === 'connected' && idleCountdown !== null ? 'hibernating' :
    conn === 'connected' ? activity :
    'idle'

  const latestLines = transcript.slice(-TRANSCRIPT_WINDOW)
  const showTranscript = conn === 'connected' && latestLines.length > 0 && idleCountdown === null

  return (
    <div
      className="foreman-orb-root"
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {showTranscript && (
        <div className="foreman-orb-transcript">
          {latestLines.map((line) => (
            <div
              key={line.id}
              className="foreman-orb-line"
              style={{ opacity: line.final ? 1 : 0.65 }}
            >
              <span className={`foreman-orb-role ${line.role === 'user' ? 'you' : 'frmn'}`}>
                {line.role === 'user' ? 'YOU' : 'FRMN'}
              </span>
              <span>{line.text}</span>
            </div>
          ))}
        </div>
      )}

      {idleCountdown !== null && (
        <div className="foreman-orb-hint">
          Sleeping in {idleCountdown}s · tap to keep
        </div>
      )}

      {error && (
        <div className="foreman-orb-error">{error}</div>
      )}

      <button
        className={`foreman-orb foreman-orb-${visualState}`}
        onClick={handleOrbClick}
        aria-label={`Foreman ${visualState}`}
        title={orbTitle(visualState)}
      >
        <OrbBlob state={visualState} />
      </button>
    </div>
  )
}

function appendTranscript(
  prev: TranscriptLine[],
  role: 'user' | 'assistant',
  text: string,
  final: boolean,
): TranscriptLine[] {
  if (!text) return prev
  const last = prev[prev.length - 1]
  if (last && last.role === role && !last.final) {
    const updated = { ...last, text: final ? text : last.text + text, final }
    return [...prev.slice(0, -1), updated]
  }
  return [...prev, { id: `${role}-${Date.now()}-${Math.random()}`, role, text, final }]
}

function orbTitle(state: VisualState): string {
  switch (state) {
    case 'idle': return 'Foreman — tap to start'
    case 'connecting': return 'Connecting...'
    case 'listening': return 'Listening — tap to stop'
    case 'speaking': return 'Speaking — tap to stop'
    case 'hibernating': return 'Sleeping soon — tap to keep'
  }
}

function OrbBlob({ state }: { state: VisualState }) {
  const big = state === 'listening' || state === 'speaking' || state === 'connecting'
  const size = big ? 56 : 40
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`foreman-orb-svg foreman-orb-svg-${state}`}
    >
      <defs>
        <radialGradient id="foreman-orb-grad" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="var(--ds-accent, #4a90e2)" stopOpacity="0.95" />
          <stop offset="55%" stopColor="var(--ds-accent, #4a90e2)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--ds-accent, #4a90e2)" stopOpacity="0.1" />
        </radialGradient>
      </defs>
      <circle
        className="foreman-orb-ring"
        cx="50"
        cy="50"
        r="46"
        fill="none"
        stroke="var(--ds-accent, #4a90e2)"
        strokeOpacity="0.35"
        strokeWidth="1.5"
      />
      <circle
        className="foreman-orb-outer"
        cx="50"
        cy="50"
        r="40"
        fill="url(#foreman-orb-grad)"
      />
      <circle
        className="foreman-orb-inner"
        cx="50"
        cy="50"
        r="22"
        fill="url(#foreman-orb-grad)"
      />
    </svg>
  )
}
