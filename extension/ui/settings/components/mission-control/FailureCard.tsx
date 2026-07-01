// Failure card — distinct from stall; retry or reassign to a different agent.
// STUB: floor-ui fills the body. Rendered in the Floor needs-you / feed.
import type { FloorAgent } from './floorModel'
import type { InstalledAgent } from './dispatch.types'

export interface FailureCardProps {
  agent: FloorAgent
  agents: InstalledAgent[]     // for reassign
  onRetry: () => void
  onReassign: (toAgent: string) => void
}

export function FailureCard(_props: FailureCardProps) {
  return null
}
