// Consolidated Dispatch panel — replaces the 5 legacy dispatch surfaces.
// STUB: props are the contract; dispatch-ui fills the body to match
// extension/docs/prototypes/dispatch.html 1:1. Do not change the props without
// telling the integrator.
import type { UnifiedTask } from '../../types'
import type { InstalledAgent, DispatchHost, DispatchTarget, DispatchRequest } from './dispatch.types'

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

export function DispatchPanel(_props: DispatchPanelProps) {
  return null
}
