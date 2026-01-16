import React from 'react'
import { Button } from '../ui/button'
import { SectionHeader } from '../common'
import { formatSessionTimestamp, formatTimeAgoSafe, formatPreview, getAgentDisplayName } from '../../utils'
import { AgentSession } from '../../types'
import { SESSIONS_PER_PAGE } from '../../constants'

interface SessionsTabProps {
  sessions: AgentSession[]
  loading: boolean
  page: number
  onPageChange: (page: number) => void
  onOpenSession: (session: AgentSession) => void
  onRefresh: () => void
}

export function SessionsTab({
  sessions,
  loading,
  page,
  onPageChange,
  onOpenSession,
  onRefresh,
}: SessionsTabProps) {
  const sorted = [...sessions].sort((a, b) => {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  })
  const totalPages = Math.max(1, Math.ceil(sorted.length / SESSIONS_PER_PAGE))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * SESSIONS_PER_PAGE
  const pageSessions = sorted.slice(start, start + SESSIONS_PER_PAGE)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionHeader className="mb-0">Sessions</SectionHeader>
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading}>
          Refresh
        </Button>
      </div>

      {loading && sessions.length === 0 ? (
        <div className="text-center py-8 text-[var(--muted-foreground)]">Loading sessions...</div>
      ) : sessions.length === 0 ? (
        <div className="text-center py-8 text-[var(--muted-foreground)]">No recent sessions found.</div>
      ) : (
        <>
          <div className="rounded-xl bg-[var(--muted)] overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-[var(--muted-foreground)] border-b border-[var(--border)]">
                <tr>
                  <th className="px-4 py-3 w-24">Agent</th>
                  <th className="px-4 py-3">Session</th>
                  <th className="px-4 py-3 w-48">Time</th>
                  <th className="px-4 py-3">Preview</th>
                  <th className="px-4 py-3 w-24 text-right">Open</th>
                </tr>
              </thead>
              <tbody>
                {pageSessions.map(session => (
                  <tr key={session.path} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium">
                        {getAgentDisplayName(session.agentType)}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">{session.sessionId}</td>
                    <td className="px-4 py-3 text-xs text-[var(--muted-foreground)]">
                      <div>{formatSessionTimestamp(session.timestamp)}</div>
                      <div>{formatTimeAgoSafe(session.timestamp)}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--muted-foreground)]">
                      <div className="max-h-12 overflow-hidden break-words">
                        {formatPreview(session.preview)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" onClick={() => onOpenSession(session)}>
                        Open
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {sessions.length > 0 && (
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onPageChange(Math.max(1, safePage - 1))}
                disabled={safePage === 1}
              >
                Previous
              </Button>
              <span className="text-sm text-[var(--muted-foreground)]">
                Page {safePage} of {totalPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onPageChange(Math.min(totalPages, safePage + 1))}
                disabled={safePage >= totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
