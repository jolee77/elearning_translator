import { useEffect, useMemo, useState } from 'react'
import { ChunkProgressPanel } from '../ui/ChunkProgressPanel'
import { Spinner } from '../ui/Spinner'
import { SuggestionHighlight } from '../ui/SuggestionHighlight'
import { useToast } from '../../hooks/ToastProvider'
import {
  hasSpellingChanges,
  isSpellingCheckComplete,
  isSpellingCheckInterrupted,
  isSpellingPendingReview,
  isSpellingReviewSettled,
  useApplySpellingFix,
  useBulkApplySpellingFix,
  useCompleteSpellingReview,
  useRunSpellingCheck,
  useSkipSpellingFix,
  useSpellingResults,
} from '../../hooks/useSpelling'
import { useSlides } from '../../hooks/useSlides'
import type { ChunkProgress } from '../../lib/chunkProgress'
import { fieldKeyLabel } from '../../lib/slideFields'
import { isStepAccessible, stepPrerequisiteMessage } from '../../lib/projectStatus'
import type { Project, SpellingResult } from '../../types'

interface SpellingStepProps {
  project: Project
}

type CheckPhase = 'idle' | 'running' | 'done' | 'error'

const WORKFLOW_STEPS = [
  '추출 텍스트 AI 검사',
  '수정안 검토·선택',
  '선택 항목 슬라이드 반영',
  '검토 완료 → 번역',
] as const

export function SpellingStep({ project }: SpellingStepProps) {
  const { showToast } = useToast()
  const { data: slides = [], isLoading: slidesLoading } = useSlides(project.id)
  const { data: results = [], isLoading: resultsLoading } = useSpellingResults(project.id)
  const runSpelling = useRunSpellingCheck()
  const applyFix = useApplySpellingFix()
  const bulkApply = useBulkApplySpellingFix()
  const skipFix = useSkipSpellingFix()
  const completeReview = useCompleteSpellingReview()

  const [chunkProgress, setChunkProgress] = useState<ChunkProgress | null>(null)
  const [checkPhase, setCheckPhase] = useState<CheckPhase>('idle')
  const [lastSummary, setLastSummary] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

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

  const pendingReview = useMemo(
    () => results.filter(isSpellingPendingReview),
    [results],
  )

  const checkCompleted =
    isSpellingCheckComplete(project.status) ||
    checkPhase === 'done' ||
    results.length > 0

  const checkInterrupted =
    isSpellingCheckInterrupted(project.status) &&
    checkPhase !== 'running' &&
    results.length === 0

  const reviewSettled = isSpellingReviewSettled(results)
  const canCompleteReview =
    checkCompleted && reviewSettled && checkPhase !== 'running'

  const isRunning = checkPhase === 'running'

  const activeWorkflowStep = useMemo(() => {
    if (!checkCompleted) return 0
    if (!reviewSettled) return 1
    if (pendingReview.length > 0) return 2
    return 3
  }, [checkCompleted, reviewSettled, pendingReview.length])

  useEffect(() => {
    setSelectedIds((prev) => {
      const pendingIds = new Set(pendingReview.map((r) => r.id))
      const next = new Set<string>()
      for (const id of prev) {
        if (pendingIds.has(id)) next.add(id)
      }
      return next
    })
  }, [pendingReview])

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllPending = () => {
    setSelectedIds(new Set(pendingReview.map((r) => r.id)))
  }

  const handleRunSpelling = async () => {
    if (!accessible) {
      showToast(stepPrerequisiteMessage(2), 'error')
      return
    }

    setCheckPhase('running')
    setChunkProgress(null)
    setLastSummary(null)
    setSelectedIds(new Set())
    try {
      const summary = await runSpelling.mutateAsync({
        projectId: project.id,
        slideIds: eligibleSlides.map((s) => s.id),
        onChunkProgress: setChunkProgress,
      })

      setCheckPhase('done')
      const message =
        summary.changeCount > 0
          ? `검사 완료: ${summary.processedSlides}개 슬라이드, 검토 필요 ${summary.changeCount}건 — 슬라이드에는 아직 반영되지 않았습니다.`
          : `검사 완료: ${summary.processedSlides}개 슬라이드, 수정이 필요한 항목이 없습니다.`
      setLastSummary(message)
      showToast(message, 'success')
    } catch (err) {
      setCheckPhase('error')
      showToast(err instanceof Error ? err.message : '맞춤법 검사에 실패했습니다.', 'error')
    } finally {
      setChunkProgress(null)
    }
  }

  const handleBulkApply = async () => {
    const targets = pendingReview.filter((r) => selectedIds.has(r.id))
    if (targets.length === 0) {
      showToast('슬라이드에 적용할 항목을 선택해 주세요.', 'error')
      return
    }

    try {
      const count = await bulkApply.mutateAsync({
        results: targets,
        slides,
        projectId: project.id,
      })
      setSelectedIds(new Set())
      showToast(`${count}건이 슬라이드에 반영되었습니다.`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '적용에 실패했습니다.', 'error')
    }
  }

  const handleBulkSkip = async () => {
    const targets = pendingReview.filter((r) => selectedIds.has(r.id))
    if (targets.length === 0) {
      showToast('적용 안 함으로 표시할 항목을 선택해 주세요.', 'error')
      return
    }

    try {
      await skipFix.mutateAsync({
        resultIds: targets.map((r) => r.id),
        projectId: project.id,
      })
      setSelectedIds(new Set())
      showToast(`${targets.length}건을 적용 안 함으로 처리했습니다.`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '처리에 실패했습니다.', 'error')
    }
  }

  const handleSkipOne = async (result: SpellingResult) => {
    try {
      await skipFix.mutateAsync({
        resultIds: [result.id],
        projectId: project.id,
      })
      showToast('적용 안 함으로 표시했습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '처리에 실패했습니다.', 'error')
    }
  }

  const handleApplyOne = async (result: SpellingResult) => {
    const slide = slideMap.get(result.slide_id)
    if (!slide) {
      showToast('슬라이드를 찾을 수 없습니다.', 'error')
      return
    }

    try {
      await applyFix.mutateAsync({ result, slide, projectId: project.id })
      showToast('슬라이드에 반영되었습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '적용에 실패했습니다.', 'error')
    }
  }

  const handleComplete = async () => {
    if (!reviewSettled) {
      showToast('아직 검토하지 않은 수정안이 있습니다. 적용 또는 적용 안 함을 선택해 주세요.', 'error')
      return
    }

    try {
      await completeReview.mutateAsync({ projectId: project.id })
      showToast('맞춤법 검토가 완료되었습니다. 번역 단계로 진행할 수 있습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '완료 처리에 실패했습니다.', 'error')
    }
  }

  const isBusy =
    isRunning ||
    runSpelling.isPending ||
    applyFix.isPending ||
    bulkApply.isPending ||
    skipFix.isPending ||
    completeReview.isPending

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
            추출된 텍스트를 검사 중입니다. 슬라이드 내용은 아직 변경되지 않습니다.
          </p>
        </div>
      )
    }

    if (results.length > 0) {
      return (
        <div className="space-y-4">
          {pendingReview.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <button
                type="button"
                onClick={selectAllPending}
                disabled={isBusy}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                검토 대기 전체 선택 ({pendingReview.length})
              </button>
              <button
                type="button"
                onClick={handleBulkApply}
                disabled={isBusy || selectedIds.size === 0}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600 disabled:opacity-50"
              >
                선택 항목 슬라이드에 적용 ({selectedIds.size})
              </button>
              <button
                type="button"
                onClick={handleBulkSkip}
                disabled={isBusy || selectedIds.size === 0}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                선택 항목 적용 안 함
              </button>
            </div>
          )}

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
                  const pending = isSpellingPendingReview(result)
                  const checked = selectedIds.has(result.id)

                  return (
                    <div key={result.id} className="px-4 py-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        {pending && (
                          <label className="inline-flex items-center gap-1.5 text-xs text-gray-700">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSelected(result.id)}
                              disabled={isBusy}
                              className="rounded border-gray-300 text-accent focus:ring-accent/30"
                            />
                            슬라이드에 적용
                          </label>
                        )}
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                          {fieldKeyLabel(result.field)}
                        </span>
                        {result.applied && (
                          <span className="text-xs font-medium text-emerald-600">슬라이드 반영됨</span>
                        )}
                        {result.skipped && !result.applied && (
                          <span className="text-xs font-medium text-gray-500">적용 안 함</span>
                        )}
                        {!hasChange && (
                          <span className="text-xs text-gray-500">수정 불필요</span>
                        )}
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <p className="text-xs font-medium text-gray-500">원문 (추출 텍스트)</p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">
                            {result.original}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-gray-500">AI 수정안</p>
                          <p className="mt-1 whitespace-pre-wrap text-sm">
                            <SuggestionHighlight
                              original={result.original}
                              suggestion={result.suggestion}
                              highlightChanges={hasChange}
                            />
                          </p>
                        </div>
                      </div>
                      {pending && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleApplyOne(result)}
                            disabled={isBusy}
                            className="rounded-lg border border-accent px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/5 disabled:opacity-50"
                          >
                            이 항목만 슬라이드에 적용
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSkipOne(result)}
                            disabled={isBusy}
                            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                          >
                            적용 안 함
                          </button>
                        </div>
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
          <p className="mt-1 text-xs text-amber-800">다시 실행해 주세요.</p>
        </div>
      )
    }

    if (checkPhase === 'error') {
      return (
        <div className="rounded-xl border border-red-200 bg-red-50 py-16 text-center">
          <p className="text-sm font-medium text-red-800">맞춤법 검사에 실패했습니다.</p>
        </div>
      )
    }

    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
        <p className="text-sm text-gray-500">추출된 텍스트에 대해 AI 맞춤법 검사를 실행하세요.</p>
        <p className="mt-1 text-xs text-gray-400">
          검사 결과는 먼저 검토·선택한 뒤, 승인한 항목만 슬라이드에 반영됩니다.
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
            추출 텍스트를 AI로 검사하고, 설계자가 선택한 수정안만 슬라이드에 반영합니다.
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

      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {WORKFLOW_STEPS.map((label, index) => {
          const done = index < activeWorkflowStep
          const active = index === activeWorkflowStep
          return (
            <li
              key={label}
              className={`rounded-lg border px-3 py-2 text-xs ${
                done
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : active
                    ? 'border-accent/40 bg-accent/5 text-accent'
                    : 'border-gray-200 bg-gray-50 text-gray-500'
              }`}
            >
              <span className="font-semibold">{index + 1}. </span>
              {label}
            </li>
          )
        })}
      </ol>

      {!accessible && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {stepPrerequisiteMessage(2)}
        </div>
      )}

      {isRunning && (
        <ChunkProgressPanel
          title="맞춤법 검사"
          progress={chunkProgress}
          hint={`${eligibleSlides.length}개 슬라이드를 5개씩 나누어 검사합니다. 슬라이드 원본은 변경되지 않습니다.`}
        />
      )}

      {lastSummary && checkPhase === 'done' && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          {lastSummary}
        </div>
      )}

      {checkCompleted && pendingReview.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          검토 대기 {pendingReview.length}건 — 체크 후 「슬라이드에 적용」 또는 「적용 안 함」을 선택하세요.
        </div>
      )}

      {checkCompleted && reviewSettled && pendingReview.length === 0 && results.length > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          모든 수정안 검토가 끝났습니다. 「검토 완료 → 번역」으로 다음 단계로 진행하세요.
        </div>
      )}

      {renderMainContent()}
    </div>
  )
}
