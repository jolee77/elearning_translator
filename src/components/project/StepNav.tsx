import {
  canNavigateToStep,
  PROJECT_STEPS,
  statusToStep,
} from '../../lib/projectStatus'
import type { ProjectStatus } from '../../types'

interface StepNavProps {
  status: ProjectStatus
  activeStep?: number
  onStepClick?: (step: number) => void
}

export function StepNav({ status, activeStep, onStepClick }: StepNavProps) {
  const currentStep = statusToStep(status)
  const displayStep = activeStep ?? currentStep

  return (
    <nav aria-label="프로젝트 진행 단계">
      <ol className="flex items-center">
        {PROJECT_STEPS.map(({ step, label }, index) => {
          const isCompleted = step < currentStep
          const isCurrent = step === displayStep
          const isLast = index === PROJECT_STEPS.length - 1
          const canNavigate = canNavigateToStep(step, status)
          const isClickable = !!onStepClick

          const stepCircle = (
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                isCompleted
                  ? 'bg-[#1677ff] text-white'
                  : isCurrent
                    ? 'bg-[#162b52] text-white ring-4 ring-[#162b52]/20'
                    : canNavigate
                      ? 'bg-gray-200 text-gray-600'
                      : 'bg-gray-100 text-gray-400'
              }`}
            >
              {isCompleted ? (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              ) : (
                step
              )}
            </div>
          )

          return (
            <li key={step} className={`flex items-center ${isLast ? '' : 'flex-1'}`}>
              <div className="flex flex-col items-center">
                {isClickable ? (
                  <button
                    type="button"
                    onClick={() => onStepClick(step)}
                    disabled={!canNavigate}
                    title={!canNavigate ? '이전 단계를 먼저 완료해 주세요' : label}
                    className={`rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1677ff]/50 ${
                      canNavigate ? 'cursor-pointer hover:opacity-90' : 'cursor-not-allowed'
                    }`}
                    aria-current={isCurrent ? 'step' : undefined}
                  >
                    {stepCircle}
                  </button>
                ) : (
                  stepCircle
                )}
                <span
                  className={`mt-2 hidden text-center text-xs font-medium xl:block ${
                    isCurrent ? 'text-[#162b52]' : isCompleted ? 'text-gray-700' : 'text-gray-400'
                  }`}
                >
                  {label}
                </span>
              </div>

              {!isLast && (
                <div
                  className={`mx-2 h-0.5 flex-1 ${
                    isCompleted ? 'bg-[#1677ff]' : 'bg-gray-200'
                  }`}
                />
              )}
            </li>
          )
        })}
      </ol>

      <p className="mt-3 text-center text-sm font-medium text-[#162b52] xl:hidden">
        {PROJECT_STEPS[displayStep - 1].label}
      </p>
    </nav>
  )
}
