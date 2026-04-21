import React, { useMemo } from 'react'
import type { CycleInfo } from '../../types'

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

interface DayCell {
  key: string
  num: number
  isToday: boolean
  isCreated: boolean
  inCycle: boolean
  isOtherMonth: boolean
}

function buildMonthGrid(
  createdDate: Date,
  today: Date,
  cycleStart: Date | null,
  cycleEnd: Date | null,
): DayCell[] {
  const year = createdDate.getFullYear()
  const month = createdDate.getMonth()

  const firstOfMonth = new Date(year, month, 1)
  const lastOfMonth = new Date(year, month + 1, 0)

  // Monday = 0 in our grid. JS getDay(): 0=Sun, 1=Mon...
  const startDow = (firstOfMonth.getDay() + 6) % 7
  const daysInMonth = lastOfMonth.getDate()

  const cells: DayCell[] = []

  // Leading days from previous month
  const prevMonthLast = new Date(year, month, 0).getDate()
  for (let i = startDow - 1; i >= 0; i--) {
    const day = prevMonthLast - i
    const date = new Date(year, month - 1, day)
    cells.push({
      key: `prev-${day}`,
      num: day,
      isToday: false,
      isCreated: false,
      inCycle: isInCycle(date, cycleStart, cycleEnd),
      isOtherMonth: true,
    })
  }

  // Current month days
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day)
    cells.push({
      key: `cur-${day}`,
      num: day,
      isToday: isSameDay(date, today),
      isCreated: isSameDay(date, createdDate),
      inCycle: isInCycle(date, cycleStart, cycleEnd),
      isOtherMonth: false,
    })
  }

  // Trailing days to fill last row
  const remaining = 7 - (cells.length % 7)
  if (remaining < 7) {
    for (let day = 1; day <= remaining; day++) {
      const date = new Date(year, month + 1, day)
      cells.push({
        key: `next-${day}`,
        num: day,
        isToday: false,
        isCreated: false,
        inCycle: isInCycle(date, cycleStart, cycleEnd),
        isOtherMonth: true,
      })
    }
  }

  return cells
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

function isInCycle(date: Date, start: Date | null, end: Date | null): boolean {
  if (!start || !end) return false
  const d = date.getTime()
  // Compare by day boundaries (start of day)
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime()
  return d >= s && d <= e
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

interface TaskCalendarProps {
  createdAt?: string
  cycleInfo?: CycleInfo | null
}

export function TaskCalendar({ createdAt, cycleInfo }: TaskCalendarProps) {
  const data = useMemo(() => {
    if (!createdAt) return null

    const created = new Date(createdAt)
    if (isNaN(created.getTime())) return null

    const today = new Date()
    const cycleStart = cycleInfo ? new Date(cycleInfo.startsAt) : null
    const cycleEnd = cycleInfo ? new Date(cycleInfo.endsAt) : null

    const cells = buildMonthGrid(created, today, cycleStart, cycleEnd)
    const monthYear = `${MONTH_NAMES[created.getMonth()]} ${created.getFullYear()}`

    return { cells, monthYear, hasCycle: !!cycleInfo }
  }, [createdAt, cycleInfo])

  if (!data) return null

  return (
    <div className="sw-task-calendar">
      <div className="sw-panel-section-head">Timeline</div>
      <div className="sw-calendar-header">
        <span className="sw-calendar-month">{data.monthYear}</span>
      </div>
      <div className="sw-calendar-weekdays">
        {WEEKDAYS.map(d => <span key={d}>{d}</span>)}
      </div>
      <div className="sw-calendar-grid">
        {data.cells.map(day => {
          const classes = ['sw-calendar-day']
          if (day.isOtherMonth) classes.push('other-month')
          if (day.inCycle) classes.push('in-cycle')
          if (day.isToday) classes.push('today')
          if (day.isCreated) classes.push('created')
          return (
            <span key={day.key} className={classes.join(' ')}>
              {day.num}
            </span>
          )
        })}
      </div>
      <div className="sw-calendar-legend">
        <span className="sw-calendar-legend-item created">Created</span>
        {data.hasCycle && (
          <span className="sw-calendar-legend-item cycle">Cycle</span>
        )}
        <span className="sw-calendar-legend-item today-legend">Today</span>
      </div>
    </div>
  )
}
