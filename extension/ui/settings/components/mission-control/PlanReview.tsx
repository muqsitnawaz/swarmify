// Plan-review surface — when a Plan-mode agent emits a plan, approve / edit / send back.
// STUB: floor-ui fills the body. Rendered in the Floor right pane / needs-you.
import type { PendingPlan, PlanStep } from './dispatch.types'

export interface PlanReviewProps {
  plan: PendingPlan
  onApprove: (edited?: PlanStep[]) => void
  onSendBack: (note: string) => void
}

export function PlanReview(_props: PlanReviewProps) {
  return null
}
