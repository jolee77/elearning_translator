import type { ProjectStatus } from '../types'

export const PROJECT_STEPS = [
  { step: 1, label: '추출 확인' },
  { step: 2, label: '맞춤법 검사' },
  { step: 3, label: '번역 대상 선택' },
  { step: 4, label: '번역·역번역 검증' },
  { step: 5, label: '전문가 검증' },
  { step: 6, label: '완료' },
] as const

const PHASE_LABELS = ['업로드', '맞춤법', '대상선택', '번역검증', '전문가검토', '완료'] as const

const PHASE_BADGE_CLASSES = [
  'bg-sky-100 text-sky-800',
  'bg-amber-100 text-amber-800',
  'bg-orange-100 text-orange-800',
  'bg-violet-100 text-violet-800',
  'bg-indigo-100 text-indigo-800',
  'bg-emerald-100 text-emerald-800',
] as const

const STATUS_ORDER: ProjectStatus[] = [
  'uploaded',
  'extracted',
  'spelling',
  'spelling_done',
  'selection_done',
  'translating',
  'translated',
  'verifying',
  'verified',
  'expert_review',
  'done',
]

export function statusToStep(status: ProjectStatus): number {
  switch (status) {
    case 'uploaded':
      return 1
    case 'extracted':
    case 'spelling':
      return 2
    case 'spelling_done':
      return 3
    case 'selection_done':
    case 'translating':
    case 'translated':
    case 'verifying':
      return 4
    case 'verified':
    case 'expert_review':
      return 5
    case 'done':
      return 6
    default:
      return 1
  }
}

export function statusToPhaseLabel(status: ProjectStatus): string {
  return PHASE_LABELS[statusToStep(status) - 1]
}

export function statusToBadgeClass(status: ProjectStatus): string {
  return PHASE_BADGE_CLASSES[statusToStep(status) - 1]
}

export function isStatusAtLeast(status: ProjectStatus, minimum: ProjectStatus): boolean {
  return STATUS_ORDER.indexOf(status) >= STATUS_ORDER.indexOf(minimum)
}

const STEP_MINIMUM_STATUS: Record<number, ProjectStatus> = {
  2: 'extracted',
  3: 'spelling_done',
  4: 'selection_done',
  5: 'verified',
  6: 'expert_review',
}

export function isStepAccessible(step: number, status: ProjectStatus): boolean {
  const minimum = STEP_MINIMUM_STATUS[step]
  if (!minimum) return true
  return isStatusAtLeast(status, minimum)
}

/** 완료된 단계로 돌아가기 또는 다음 단계 진입 가능 여부 */
export function canNavigateToStep(step: number, status: ProjectStatus): boolean {
  if (step === 1) return true
  if (step === 6) return status === 'done'
  const current = statusToStep(status)
  if (step <= current) return true
  return isStepAccessible(step, status)
}

export function stepPrerequisiteMessage(step: number): string {
  switch (step) {
    case 2:
      return '이전 단계(추출 확인)를 먼저 완료해 주세요.'
    case 3:
      return '이전 단계(맞춤법 검사)를 먼저 완료해 주세요.'
    case 4:
      return '이전 단계(번역 대상 선택)를 먼저 완료해 주세요.'
    case 5:
      return '이전 단계(번역·역번역 검증)를 먼저 완료해 주세요.'
    case 6:
      return '전문가 검증이 완료된 후 완료 단계로 이동할 수 있습니다.'
    default:
      return '이전 단계를 먼저 완료해 주세요.'
  }
}
