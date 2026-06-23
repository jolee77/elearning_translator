import { statusToBadgeClass, statusToPhaseLabel } from '../../lib/projectStatus'
import type { ProjectStatus } from '../../types'

interface StatusBadgeProps {
  status: ProjectStatus
  className?: string
}

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusToBadgeClass(status)} ${className}`}
    >
      {statusToPhaseLabel(status)}
    </span>
  )
}
