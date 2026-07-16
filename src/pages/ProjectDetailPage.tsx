import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ExtractionStep } from '../components/project/ExtractionStep'
import { SpellingStep } from '../components/project/SpellingStep'
import { SlideExclusionStep } from '../components/project/SlideExclusionStep'
import { StatusBadge } from '../components/project/StatusBadge'
import { StepNav } from '../components/project/StepNav'
import { TranslationVerificationStep } from '../components/project/TranslationVerificationStep'
import { ExpertReviewStep } from '../components/project/ExpertReviewStep'
import { DoneStep } from '../components/project/DoneStep'
import { Spinner } from '../components/ui/Spinner'
import { useToast } from '../hooks/ToastProvider'
import { useProject } from '../hooks/useProject'
import { canNavigateToStep, statusToStep, stepPrerequisiteMessage } from '../lib/projectStatus'

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: project, isLoading, error } = useProject(id)
  const { showToast } = useToast()
  const [viewStep, setViewStep] = useState(1)

  const currentStep = project ? statusToStep(project.status) : 1

  useEffect(() => {
    if (!project) return
    setViewStep((prev) => {
      const next = statusToStep(project.status)
      // 맞춤법 검토 중(spelling)에는 자동으로 다음 단계로 넘기지 않음
      if (project.status === 'spelling' && prev === 2) return prev
      // 번역 대상 선택 중(spelling_done)에도 Step 3에 머무름
      if (project.status === 'spelling_done' && prev === 3) return prev
      return next
    })
  }, [project?.status, project?.id])

  const handleStepClick = (step: number) => {
    if (!project) return
    if (!canNavigateToStep(step, project.status)) {
      showToast(stepPrerequisiteMessage(step), 'error')
      return
    }
    setViewStep(step)
  }

  if (isLoading) {
    return (
      <div className="nb-empty-state">
        <Spinner className="text-gray-400" />
        <p className="text-sm text-gray-500">프로젝트를 불러오는 중...</p>
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="nb-alert nb-alert--error">
        프로젝트를 찾을 수 없습니다.
        <Link to="/dashboard" className="nb-link ml-2">
          대시보드로 돌아가기
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="nb-page-toolbar">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{project.title}</h2>
          <p className="mt-1 text-sm text-gray-500">
            생성일: {new Date(project.created_at).toLocaleDateString('ko-KR')}
          </p>
        </div>
        <StatusBadge status={project.status} />
      </div>

      <div className="nb-card p-4 sm:p-6">
        <StepNav
          status={project.status}
          activeStep={viewStep}
          onStepClick={handleStepClick}
        />
        {viewStep !== currentStep && (
          <p className="mt-3 text-center text-xs text-gray-500">
            이전 단계를 확인 중입니다. 현재 진행 단계:{' '}
            <button
              type="button"
              onClick={() => setViewStep(currentStep)}
              className="nb-link font-medium"
            >
              {currentStep}단계로 이동
            </button>
          </p>
        )}
      </div>

      {viewStep === 1 && (
        <div className="nb-card p-4 sm:p-6">
          <ExtractionStep project={project} onStepComplete={() => setViewStep(2)} />
        </div>
      )}

      {viewStep === 2 && (
        <div className="nb-card p-4 sm:p-6">
          <SpellingStep project={project} onStepComplete={() => setViewStep(3)} />
        </div>
      )}

      {viewStep === 3 && (
        <div className="nb-card p-4 sm:p-6">
          <SlideExclusionStep project={project} onStepComplete={() => setViewStep(4)} />
        </div>
      )}

      {viewStep === 4 && (
        <div className="nb-card nb-input-surface p-4 sm:p-6">
          <TranslationVerificationStep project={project} onStepComplete={() => setViewStep(5)} />
        </div>
      )}

      {viewStep === 5 && (
        <div className="nb-card p-4 sm:p-6">
          <ExpertReviewStep project={project} />
        </div>
      )}

      {viewStep === 6 && (
        <div className="nb-card p-4 sm:p-6">
          <DoneStep project={project} />
        </div>
      )}
    </div>
  )
}
