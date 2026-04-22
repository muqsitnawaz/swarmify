import React, { useEffect, useState } from 'react'

interface ForemanTabProps {
  vscode: {
    postMessage: (msg: any) => void
  }
}

interface TranscriptLine {
  id: string
  role: 'user' | 'assistant'
  text: string
  final: boolean
}

type ConnState = 'idle' | 'connecting' | 'connected' | 'closed' | 'error'

export function ForemanTab({ vscode }: ForemanTabProps) {
  const [conn, setConn] = useState<ConnState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const m = event.data
      if (m?.type === 'foreman.status') {
        setConn(m.status)
        if (m.status === 'error') setError(m.detail ?? 'error')
        else if (m.status === 'connected' || m.status === 'connecting') setError(null)
      } else if (m?.type === 'foreman.transcript') {
        setTranscript((prev) => appendTranscript(prev, m.role, m.text, m.final))
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      vscode.postMessage({ type: 'foreman.stopSession' })
    }
  }, [])

  const handleConnect = () => {
    setError(null)
    setTranscript([])
    setConn('connecting')
    vscode.postMessage({ type: 'foreman.startSession' })
  }

  const handleDisconnect = () => {
    vscode.postMessage({ type: 'foreman.stopSession' })
    setConn('closed')
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Foreman</div>
        <div style={{ fontSize: 12, color: 'var(--ds-text-muted)' }}>
          Your voice coordinator. Asks the floor what's going on, brings it back in one sentence.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {conn === 'connected' || conn === 'connecting' ? (
          <button className="sw-btn" onClick={handleDisconnect}>
            Stop
          </button>
        ) : (
          <button className="sw-btn" onClick={handleConnect}>
            Start conversation
          </button>
        )}
        <StatusDot state={conn} />
        <span style={{ fontSize: 12, color: 'var(--ds-text-muted)' }}>{labelFor(conn)}</span>
      </div>

      {error && (
        <div style={{
          color: 'var(--ds-danger, #c03030)',
          fontSize: 12,
          fontFamily: 'var(--ds-font-mono, ui-monospace, monospace)',
          padding: 8,
          border: '1px solid var(--ds-border)',
          borderRadius: 4,
          background: 'var(--ds-bg-panel)',
          whiteSpace: 'pre-wrap',
        }}>
          {error}
        </div>
      )}

      <div style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        border: '1px solid var(--ds-border)',
        borderRadius: 6,
        padding: 12,
        background: 'var(--ds-bg-panel)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        {transcript.length === 0 && (
          <div style={{ color: 'var(--ds-text-dim)', fontSize: 12, fontStyle: 'italic' }}>
            Press Start, then ask: "what's everyone doing?"
          </div>
        )}
        {transcript.map((line) => (
          <TranscriptRow key={line.id} line={line} />
        ))}
      </div>
    </div>
  )
}

function appendTranscript(prev: TranscriptLine[], role: 'user' | 'assistant', text: string, final: boolean): TranscriptLine[] {
  if (!text) return prev
  const last = prev[prev.length - 1]
  if (last && last.role === role && !last.final) {
    const updated = { ...last, text: final ? text : last.text + text, final }
    return [...prev.slice(0, -1), updated]
  }
  return [...prev, { id: `${role}-${Date.now()}-${Math.random()}`, role, text, final }]
}

function TranscriptRow({ line }: { line: TranscriptLine }) {
  const isUser = line.role === 'user'
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <div style={{
        fontSize: 10,
        fontWeight: 600,
        color: isUser ? 'var(--ds-text-muted)' : 'var(--ds-accent, #4a90e2)',
        textTransform: 'uppercase',
        minWidth: 70,
        paddingTop: 2,
      }}>
        {isUser ? 'You' : 'Foreman'}
      </div>
      <div style={{
        fontSize: 13,
        color: 'var(--ds-text)',
        opacity: line.final ? 1 : 0.7,
        lineHeight: 1.45,
      }}>
        {line.text}
      </div>
    </div>
  )
}

function StatusDot({ state }: { state: ConnState }) {
  const color = state === 'connected' ? '#2db47a'
    : state === 'connecting' ? '#d4a72d'
    : state === 'error' ? '#c03030'
    : 'var(--ds-text-dim, #888)'
  return (
    <span style={{
      display: 'inline-block',
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: color,
    }} />
  )
}

function labelFor(state: ConnState): string {
  switch (state) {
    case 'idle': return 'idle'
    case 'connecting': return 'connecting'
    case 'connected': return 'live - foreman is listening'
    case 'closed': return 'closed'
    case 'error': return 'error'
  }
}
