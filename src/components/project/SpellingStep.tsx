import { useMemo, useState } from 'react'
import { ProgressBar } from '../ui/ProgressBar'
import { Spinner } from '../ui/Spinner'
import { useToast } from '../../hooks/ToastProvider'
import {
  hasSpellingChanges,
  isSpellingCheckComplete,
  isSpellingCheckInterrupted,
  useApplySpellingFix,
  useCompleteSpellingReview,
  useRunSpellingCheck,
  useSpellingResults,
} from '../../hooks/useSpelling'
import { useSlides } from '../../hooks/useSlides'
import { fieldKeyLabel } from '../../lib/slideFields'
import { isStepAccessible, stepPrerequisiteMessage } from '../../lib/projectStatus'
import type { Project, SpellingResult } from '../../types'

interface SpellingStepProps {
  project: Project
}

type CheckPhase = 'idle' | 'running' | 'done' | 'error'

export function SpellingStep({ project }: SpellingStepProps) {
  const { showToast } = useToast()
  const { data: slides = [], isLoading: slidesLoading } = useSlides(project.id)
  const { data: results = [], isLoading: resultsLoading } = useSpellingResults(project.id)
  const runSpelling = useRunSpellingCheck()
  const applyFix = useApplySpellingFix()
  const completeReview = useCompleteSpellingReview()

  const [progress, setProgress] = useState(0)
  const [checkPhase, setCheckPhase] = useState<CheckPhase>('idle')
  const [lastSummary, setLastSummary] = useState<string | null>(null)

  const accessible = isStepAccessible(2, project.status)
  const eligibleSlides = useMemo(
    () => slides.filter((s) => s.slide_type !== 'guide'),
    [slides],
  )

  const slideMap = useMemo(() => new Map(slides.map((s) => [s.id, s])), [slides])

  const groupedResults = useMemo(() => {
    const groups = new Map<number, SpellingResult[]>()
    for (const result of results) {
      const slide = slideMap.get(result.slide_id)
      const slideNum = slide?.slide_num ?? 0
      const list = groups.get(slideNum) ?? []
      list.push(result)
      groups.set(slideNum, list)
    }
    return [...groups.entries()].sort(([a], [b]) => a - b)
  }, [results, slideMap])

  const actionableResults = results.filter(
    (r) => hasSpellingChanges(r) && !r.applied,
  )

  const checkCompleted =
    isSpellingCheckComplete(project.status) ||
    checkPhase === 'done' ||
    results.length > 0

  const checkInterrupted =
    isSpellingCheckInterrupted(project.status) &&
    checkPhase !== 'running' &&
    results.length === 0

  const canCompleteReview =
    checkCompleted && actionableResults.length === 0 && checkPhase !== 'running'

  const isRunning = checkPhase === 'running'

  const handleRunSpelling = async () => {
    if (!accessible) {
      showToast(stepPrerequisiteMessage(2), 'error')
      return
    }

    setCheckPhase('running')
    setProgress(0)
    setLastSummary(null)
    try {
      const summary = await runSpelling.mutateAsync({
        projectId: project.id,
        slideIds: eligibleSlides.map((s) => s.id),
        onProgress: setProgress,
      })

      setCheckPhase('done')
      const message =
        summary.changeCount > 0
          ? `맞춤법 검사 완료: ${summary.processedSlides}개 슬라이드, 수정 필요 ${summary.changeCount}건`
          : `맞춤법 검사 완료: ${summary.processedSlides}개 슬라이드, 수정이 필요한 항목이 없습니다.`
      setLastSummary(message)
      showToast(message, 'success')
    } catch (err) {
      setCheckPhase('error')
      showToast(err instanceof Error ? err.message : '맞춤법 검사에 실패했습니다.', 'error')
    }
  }

  const handleApply = async (result: SpellingResult) => {
    const slide = slideMap.get(result.slide_id)
    if (!slide) {
      showToast('슬라이드를 찾을 수 없습니다.', 'error')
      return
    }

    try {
      await applyFix.mutateAsync({ result, slide, projectId: project.id })
      showToast('수정이 적용되었습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '수정 적용에 실패했습니다.', 'error')
    }
  }

  const handleComplete = async () => {
    try {
      await completeReview.mutateAsync({ projectId: project.id })
      showToast('맞춤법 검토가 완료되었습니다. 번역 단계로 진행할 수 있습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '완료 처리에 실패했습니다.', 'error')
    }
  }

  const isBusy =
    isRunning || runSpelling.isPending || applyFix.isPending || completeReview.isPending

  const renderMainContent = () => {
    if (slidesLoading || resultsLoading) {
      return (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-16">
          <Spinner className="text-gray-400" />
          <p className="text-sm text-gray-500">데이터를 불러오는 중...</p>
        </div>
      )
    }

    if (isRunning) {
      return (
        <div className="rounded-xl border border-blue-100 bg-white py-16 text-center">
          <p className="text-sm text-gray-600">
            AI가 {eligibleSlides.length}개 슬라이드의 텍스트를 검사하고 있습니다.
          </p>
          <p className="mt-1 text-xs text-gray-400">슬라이드가 많으면 수 분 정도 걸릴 수 있습니다.</p>
        </div>
      )
    }

    if (results.length > 0) {
      return (
        <div className="space-y-4">
          {groupedResults.map(([slideNum, slideResults]) => (
            <div
              key={slideNum}
              className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
            >
              <div className="border-b border-gray-100 bg-gray-50 px-4 py-2">
                <h4 className="text-sm font-semibold text-gray-800">
                  슬라이드 {slideNum}
                  <span className="ml-2 font-normal text-gray-500">
                    ({slideResults.length}건)
                  </span>
                </h4>
              </div>
              <div className="divide-y divide-gray-100">
                {slideResults.map((result) => {
                  const hasChange = hasSpellingChanges(result)

                  return (
                    <div key={result.id} className="px-4 py-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                          {fieldKeyLabel(result.field)}
                        </span>
                        {result.applied && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                            적용됨
                          </span>
                        )}
                        {!hasChange && (
                          <span className="text-xs text-gray-500">수정 불필요</span>
                        )}
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <p className="text-xs font-medium text-gray-500">원문</p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">
                            {result.original}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-gray-500">수정안</p>
                          <p
                            className={`mt-1 whitespace-pre-wrap text-sm ${
                              hasChange ? 'font-medium text-accent' : 'text-gray-800'
                            }`}
                          >
                            {result.suggestion}
                          </p>
                        </div>
                      </div>
                      {hasChange && !result.applied && (
                        <button
                          type="button"
                          onClick={() => handleApply(result)}
                          disabled={isBusy}
                          className="mt-2 rounded-lg border border-accent px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/5 disabled:opacity-50"
                        >
                          {applyFix.isPending ? '적용 중...' : '수정 적용'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )
    }

    if (checkInterrupted) {
      return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 py-16 text-center">
          <p className="text-sm font-medium text-amber-900">이전 맞춤법 검사가 중단되었습니다.</p>
          <p className="mt-1 text-xs text-amber-800">
            슬라이드 수가 많아 검사가 끝나기 전에 중단됐을 수 있습니다. 다시 실행해 주세요.
          </p>
        </div>
      )
    }

    if (checkPhase === 'error') {
      return (
        <div className="rounded-xl border border-red-200 bg-red-50 py-16 text-center">
          <p className="text-sm font-medium text-red-800">맞춤법 검사에 실패했습니다.</p>
          <p className="mt-1 text-xs text-red-700">
            추출된 화면 텍스트·나레이션이 있는지 확인한 뒤 다시 실행해 주세요.
          </p>
        </div>
      )
    }

    if (checkCompleted && lastSummary) {
      return (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 py-16 text-center">
          <p className="text-sm font-medium text-emerald-900">{lastSummary}</p>
          <p className="mt-1 text-xs text-emerald-800">
            아래 「검토 완료 → 번역」 버튼을 눌러 다음 단계로 진행하세요.
          </p>
        </div>
      )
    }

    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
        <p className="text-sm text-gray-500">아직 맞춤법 검사를 실행하지 않았습니다.</p>
        <p className="mt-1 text-xs text-gray-400">
          &quot;맞춤법 검사 실행&quot; 버튼을 눌러 AI 검사를 시작하세요.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Step 2. 맞춤법 검사</h3>
          <p className="mt-0.5 text-sm text-gray-500">
            AI 맞춤법 검사 결과를 확인하고 필요한 수정을 슬라이드에 적용합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleRunSpelling}
            disabled={isBusy || !accessible || eligibleSlides.length === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            {isRunning && <Spinner />}
            {isRunning ? '검사 중...' : checkCompleted ? '맞춤법 검사 다시 실행' : '맞춤법 검사 실행'}
          </button>
          <button
            type="button"
            onClick={handleComplete}
            disabled={isBusy || !canCompleteReview}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-600 disabled:opacity-50"
          >
            {completeReview.isPending && <Spinner className="text-white" />}
            {completeReview.isPending ? '처리 중...' : '검토 완료 → 번역'}
          </button>
        </div>
      </div>

      {!accessible && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {stepPrerequisiteMessage(2)}
        </div>
      )}

      {isRunning && (
        <ProgressBar
          progress={progress}
          indeterminate={progress < 100}
          label={`맞춤법 검사 진행 중... (${progress}%)`}
        />
      )}

      {checkCompleted && actionableResults.length === 0 && results.length > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {actionableResults.length === 0 && results.some(hasSpellingChanges)
            ? '모든 수정안이 반영되었습니다. 검토 완료 후 번역 단계로 진행하세요.'
            : '수정이 필요한 항목이 없습니다. 검토 완료 후 번역 단계로 진행하세요.'}
        </div>
      )}

      {actionableResults.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          미적용 수정안 {actionableResults.length}건이 남아 있습니다. 모두 적용하거나 검토 후 완료하세요.
        </div>
      )}

      {renderMainContent()}
    </div>
  )
}
