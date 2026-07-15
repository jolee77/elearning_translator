import { useEffect, useMemo, useState } from 'react'
import { ChunkProgressPanel } from '../ui/ChunkProgressPanel'
import { Spinner } from '../ui/Spinner'
import { SuggestionHighlight } from '../ui/SuggestionHighlight'
import { useToast } from '../../hooks/ToastProvider'
import {
  canCompleteSpellingReview,
  getApprovedSpellingResults,
  getCommittedSpellingResults,
  getUncommittedApprovedResults,
  hasSpellingChanges,
  isSpellingApproved,
  isSpellingCheckInterrupted,
  isSpellingPendingReview,
  isSpellingReviewSettled,
  useApproveSpellingFix,
  useCommitSpellingToSlides,
  useCompleteSpellingReview,
  useRejectSpellingFix,
  useResetSpellingReview,
  useRevertSpellingCommit,
  useRunSpellingCheck,
  useSpellingResults,
} from '../../hooks/useSpelling'
import { useSlides } from '../../hooks/useSlides'
import type { ChunkProgress } from '../../lib/chunkProgress'
import { getErrorMessage } from '../../lib/errors'
import { fieldKeyLabel } from '../../lib/slideFields'
import {
  buildSpellableFields,
  formatSpellingReviewReason,
  getSlideSpellingCoverage,
  getSpellingItemStatus,
  slideCoverageLabel,
  slideCoverageReason,
  spellingItemBoxClass,
  spellingSlideCardClass,
  spellingStatusBadgeClass,
} from '../../lib/spellingReview'
import { isStepAccessible, stepPrerequisiteMessage } from '../../lib/projectStatus'
import type { Project, SpellingResult } from '../../types'

interface SpellingStepProps {
  project: Project
  onStepComplete?: () => void
}

type CheckPhase = 'idle' | 'running' | 'done' | 'error'

const WORKFLOW_STEPS = [
  '추출 텍스트 AI 검사',
  '수정안 검토 (변경·제외)',
  '슬라이드에 일괄 적용',
  '검토 완료 → 번역',
] as const

export function SpellingStep({ project, onStepComplete }: SpellingStepProps) {
  const { showToast } = useToast()
  const { data: slides = [], isLoading: slidesLoading } = useSlides(project.id)
  const { data: results = [], isLoading: resultsLoading } = useSpellingResults(project.id)
  const runSpelling = useRunSpellingCheck()
  const approveFix = useApproveSpellingFix()
  const rejectFix = useRejectSpellingFix()
  const resetReview = useResetSpellingReview()
  const commitToSlides = useCommitSpellingToSlides()
  const revertCommit = useRevertSpellingCommit()
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

  const spellableSlideCount = useMemo(
    () => eligibleSlides.filter((s) => buildSpellableFields(s).length > 0).length,
    [eligibleSlides],
  )

  const coveragePriority = (coverage: ReturnType<typeof getSlideSpellingCoverage>) => {
    switch (coverage) {
      case 'pending_review':
        return 0
      case 'not_checked':
        return 1
      case 'reviewed':
        return 2
      case 'all_clear':
        return 3
      case 'no_text':
        return 4
    }
  }

  const slideReviewGroups = useMemo(() => {
    const resultsBySlide = new Map<string, SpellingResult[]>()
    for (const result of results) {
      const list = resultsBySlide.get(result.slide_id) ?? []
      list.push(result)
      resultsBySlide.set(result.slide_id, list)
    }

    const checked = results.length > 0

    return eligibleSlides
      .map((slide) => {
        const slideResults = resultsBySlide.get(slide.id) ?? []
        const spellable = buildSpellableFields(slide)
        let coverage = getSlideSpellingCoverage(slide, slideResults, checked)
        if (checked && spellable.length > 0 && slideResults.length === 0) {
          coverage = 'not_checked'
        }
        return { slide, slideResults, spellable, coverage }
      })
      .sort((a, b) => {
        const byPriority = coveragePriority(a.coverage) - coveragePriority(b.coverage)
        if (byPriority !== 0) return byPriority
        return a.slide.slide_num - b.slide.slide_num
      })
  }, [eligibleSlides, results])

  const reviewStats = useMemo(() => {
    let pendingSlides = 0
    let clearSlides = 0
    let excludedSlides = 0
    let missingSlides = 0

    for (const group of slideReviewGroups) {
      if (group.coverage === 'pending_review') pendingSlides += 1
      else if (group.coverage === 'all_clear' || group.coverage === 'reviewed') clearSlides += 1
      else if (group.coverage === 'no_text') excludedSlides += 1
      else if (group.coverage === 'not_checked' && group.spellable.length > 0) missingSlides += 1
    }

    return { pendingSlides, clearSlides, excludedSlides, missingSlides }
  }, [slideReviewGroups])

  const pendingReview = useMemo(
    () => results.filter(isSpellingPendingReview),
    [results],
  )

  const uncommittedApproved = useMemo(
    () => getUncommittedApprovedResults(results),
    [results],
  )

  const committedResults = useMemo(
    () => getCommittedSpellingResults(results),
    [results],
  )

  const approvedResults = useMemo(
    () => getApprovedSpellingResults(results),
    [results],
  )

  const checkCompleted =
    project.status === 'spelling_done' ||
    checkPhase === 'done' ||
    results.length > 0

  const checkInterrupted =
    isSpellingCheckInterrupted(project.status) &&
    checkPhase !== 'running' &&
    results.length === 0

  const reviewSettled = isSpellingReviewSettled(results)
  const fullyCommitted = canCompleteSpellingReview(results)
  const canCompleteReview =
    checkCompleted && fullyCommitted && checkPhase !== 'running'

  const isRunning = checkPhase === 'running'

  const activeWorkflowStep = useMemo(() => {
    if (!checkCompleted) return 0
    if (!reviewSettled) return 1
    if (uncommittedApproved.length > 0) return 2
    return 3
  }, [checkCompleted, reviewSettled, uncommittedApproved.length])

  useEffect(() => {
    setSelectedIds((prev) => {
      const selectableIds = new Set([
        ...pendingReview.map((r) => r.id),
        ...uncommittedApproved.map((r) => r.id),
      ])
      const next = new Set<string>()
      for (const id of prev) {
        if (selectableIds.has(id)) next.add(id)
      }
      return next
    })
  }, [pendingReview, uncommittedApproved])

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
          ? `검사 완료: 텍스트 있음 ${spellableSlideCount}개 슬라이드 전체 검사, 검토 필요 ${summary.changeCount}건`
          : `검사 완료: 텍스트 있음 ${spellableSlideCount}개 슬라이드 전체 검사, 수정이 필요한 항목이 없습니다.`
      setLastSummary(message)
      showToast(message, 'success')
    } catch (err) {
      setCheckPhase('error')
      showToast(getErrorMessage(err, '맞춤법 검사에 실패했습니다.'), 'error')
    } finally {
      setChunkProgress(null)
    }
  }

  const handleBulkApprove = async () => {
    const targets = pendingReview.filter((r) => selectedIds.has(r.id))
    if (targets.length === 0) {
      showToast('변경할 항목을 선택해 주세요.', 'error')
      return
    }

    try {
      await approveFix.mutateAsync({
        resultIds: targets.map((r) => r.id),
        projectId: project.id,
      })
      setSelectedIds(new Set())
      showToast(`${targets.length}건을 변경으로 선택했습니다.`, 'success')
    } catch (err) {
      showToast(getErrorMessage(err, '처리에 실패했습니다.'), 'error')
    }
  }

  const handleBulkReject = async () => {
    const targets = pendingReview.filter((r) => selectedIds.has(r.id))
    if (targets.length === 0) {
      showToast('제외할 항목을 선택해 주세요.', 'error')
      return
    }

    try {
      await rejectFix.mutateAsync({
        resultIds: targets.map((r) => r.id),
        projectId: project.id,
      })
      setSelectedIds(new Set())
      showToast(`${targets.length}건을 제외했습니다.`, 'success')
    } catch (err) {
      showToast(getErrorMessage(err, '처리에 실패했습니다.'), 'error')
    }
  }

  const handleApproveOne = async (result: SpellingResult) => {
    try {
      await approveFix.mutateAsync({
        resultIds: [result.id],
        projectId: project.id,
      })
      showToast('변경으로 선택했습니다.', 'success')
    } catch (err) {
      showToast(getErrorMessage(err, '처리에 실패했습니다.'), 'error')
    }
  }

  const handleRejectOne = async (result: SpellingResult) => {
    try {
      await rejectFix.mutateAsync({
        resultIds: [result.id],
        projectId: project.id,
      })
      showToast('제외했습니다.', 'success')
    } catch (err) {
      showToast(getErrorMessage(err, '처리에 실패했습니다.'), 'error')
    }
  }

  const handleResetOne = async (result: SpellingResult) => {
    try {
      await resetReview.mutateAsync({
        resultIds: [result.id],
        projectId: project.id,
      })
      showToast('검토 선택을 취소했습니다.', 'success')
    } catch (err) {
      showToast(getErrorMessage(err, '처리에 실패했습니다.'), 'error')
    }
  }

  const handleCommitAll = async () => {
    if (uncommittedApproved.length === 0) {
      showToast('슬라이드에 반영할 변경 항목이 없습니다.', 'error')
      return
    }

    try {
      const count = await commitToSlides.mutateAsync({
        results: uncommittedApproved,
        slides,
        projectId: project.id,
      })
      showToast(`${count}건이 슬라이드에 반영되었습니다.`, 'success')
    } catch (err) {
      showToast(getErrorMessage(err, '슬라이드 반영에 실패했습니다.'), 'error')
    }
  }

  const handleRevertAll = async () => {
    if (committedResults.length === 0) {
      showToast('되돌릴 반영 항목이 없습니다.', 'error')
      return
    }

    try {
      const count = await revertCommit.mutateAsync({
        results: committedResults,
        slides,
        projectId: project.id,
      })
      showToast(`${count}건의 슬라이드 반영을 되돌렸습니다.`, 'success')
    } catch (err) {
      showToast(getErrorMessage(err, '되돌리기에 실패했습니다.'), 'error')
    }
  }

  const handleComplete = async () => {
    if (!reviewSettled) {
      showToast('아직 검토하지 않은 수정안이 있습니다. 변경 또는 제외를 선택해 주세요.', 'error')
      return
    }
    if (!fullyCommitted) {
      showToast(
        '변경으로 선택한 항목을 슬라이드에 일괄 적용한 뒤 진행해 주세요.',
        'error',
      )
      return
    }

    try {
      await completeReview.mutateAsync({ projectId: project.id })
      showToast('맞춤법 검토가 완료되었습니다. 번역 단계로 진행할 수 있습니다.', 'success')
      onStepComplete?.()
    } catch (err) {
      showToast(getErrorMessage(err, '완료 처리에 실패했습니다.'), 'error')
    }
  }

  const isBusy =
    isRunning ||
    runSpelling.isPending ||
    approveFix.isPending ||
    rejectFix.isPending ||
    resetReview.isPending ||
    commitToSlides.isPending ||
    revertCommit.isPending ||
    completeReview.isPending

  const renderMainContent = () => {
    if (slidesLoading || resultsLoading) {
      return (
        <div className="nb-empty-state">
          <Spinner className="text-gray-400" />
          <p className="text-sm text-gray-500">데이터를 불러오는 중...</p>
        </div>
      )
    }

    if (isRunning) {
      return (
        <div className="nb-empty-state">
          <p className="text-sm text-gray-600">
            추출된 텍스트를 검사 중입니다. 슬라이드 내용은 아직 변경되지 않습니다.
          </p>
        </div>
      )
    }

    if (results.length > 0) {
      return (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-700">
              검사 대상 {spellableSlideCount}슬라이드
            </span>
            {reviewStats.pendingSlides > 0 && (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-900 ring-1 ring-amber-300">
                검토 필요 {reviewStats.pendingSlides}슬라이드
              </span>
            )}
            <span className="rounded-full bg-sky-100 px-2.5 py-1 text-sky-900">
              이상 없음 {reviewStats.clearSlides}슬라이드
            </span>
            {reviewStats.excludedSlides > 0 && (
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-600">
                검사 제외 {reviewStats.excludedSlides}슬라이드
              </span>
            )}
            {reviewStats.missingSlides > 0 && (
              <span className="rounded-full bg-red-100 px-2.5 py-1 font-medium text-red-800">
                결과 누락 {reviewStats.missingSlides}슬라이드 — 다시 실행해 주세요
              </span>
            )}
          </div>

          {pendingReview.length > 0 && (
            <div className="nb-summary-bar">
              <button
                type="button"
                onClick={selectAllPending}
                disabled={isBusy}
                className="nb-btn-secondary text-xs"
              >
                검토 대기 전체 선택 ({pendingReview.length})
              </button>
              <button
                type="button"
                onClick={handleBulkApprove}
                disabled={isBusy || selectedIds.size === 0}
                className="nb-btn-primary text-xs"
              >
                선택 항목 변경 ({selectedIds.size})
              </button>
              <button
                type="button"
                onClick={handleBulkReject}
                disabled={isBusy || selectedIds.size === 0}
                className="nb-btn-secondary text-xs"
              >
                선택 항목 제외
              </button>
            </div>
          )}

          {reviewSettled && approvedResults.length > 0 && (
            <div className="nb-summary-bar">
              <span className="text-xs text-gray-600">
                변경 선택 {approvedResults.length}건
                {uncommittedApproved.length > 0 && ` · 미반영 ${uncommittedApproved.length}건`}
                {committedResults.length > 0 && ` · 반영됨 ${committedResults.length}건`}
              </span>
              {uncommittedApproved.length > 0 && (
                <button
                  type="button"
                  onClick={handleCommitAll}
                  disabled={isBusy}
                  className="nb-btn-primary text-xs"
                >
                  슬라이드에 일괄 적용 ({uncommittedApproved.length})
                </button>
              )}
              {committedResults.length > 0 && (
                <button
                  type="button"
                  onClick={handleRevertAll}
                  disabled={isBusy}
                  className="nb-btn-secondary text-xs"
                >
                  슬라이드 적용 되돌리기 ({committedResults.length})
                </button>
              )}
            </div>
          )}

          {slideReviewGroups.map(({ slide, slideResults, spellable, coverage }) => (
            <div
              key={slide.id}
              className={`nb-card overflow-hidden ${spellingSlideCardClass(coverage)}`}
            >
              <div
                className={`nb-card-header ${
                  coverage === 'pending_review' ? 'bg-amber-50/80' : ''
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-semibold text-gray-800">
                    슬라이드 {slide.slide_num}
                  </h4>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${spellingStatusBadgeClass(coverage)}`}
                  >
                    {slideCoverageLabel(coverage)}
                  </span>
                  {slideResults.length > 0 && (
                    <span className="text-xs text-gray-500">
                      ({slideResults.length}개 필드 검사)
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-600">
                  {coverage === 'not_checked' && spellable.length > 0 && results.length > 0
                    ? '검사 결과가 누락되었습니다. 맞춤법 검사를 다시 실행해 주세요.'
                    : slideCoverageReason(coverage, slide, slideResults)}
                </p>
              </div>

              {slideResults.length > 0 ? (
                <div className="space-y-3 p-3">
                  {slideResults.map((result) => {
                    const itemStatus = getSpellingItemStatus(result)
                    const pending = isSpellingPendingReview(result)
                    const approved = isSpellingApproved(result)
                    const hasChange = hasSpellingChanges(result)
                    const checked = selectedIds.has(result.id)

                    return (
                      <div
                        key={result.id}
                        className={`rounded-lg px-4 py-3 ${spellingItemBoxClass(itemStatus)}`}
                      >
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          {pending && (
                            <label className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-900">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleSelected(result.id)}
                                disabled={isBusy}
                                className="rounded border-amber-400 text-amber-600 focus:ring-amber-300"
                              />
                              선택
                            </label>
                          )}
                          <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-gray-200">
                            {fieldKeyLabel(result.field)}
                          </span>
                          {itemStatus === 'pending' && (
                            <span className="text-xs font-semibold text-amber-800">
                              검토 필요
                            </span>
                          )}
                          {itemStatus === 'approved' && (
                            <span className="text-xs font-medium text-emerald-700">변경 선택</span>
                          )}
                          {itemStatus === 'rejected' && (
                            <span className="text-xs font-medium text-gray-500">제외</span>
                          )}
                          {itemStatus === 'committed' && (
                            <span className="text-xs font-medium text-indigo-700">슬라이드 반영됨</span>
                          )}
                          {itemStatus === 'no_change' && (
                            <span className="text-xs font-medium text-sky-700">이상 없음</span>
                          )}
                        </div>

                        <p
                          className={`mb-2 text-xs leading-relaxed ${
                            itemStatus === 'pending'
                              ? 'font-medium text-amber-900'
                              : 'text-gray-600'
                          }`}
                        >
                          {formatSpellingReviewReason(result)}
                        </p>

                        <div className={hasChange ? 'grid gap-3 md:grid-cols-2' : ''}>
                          <div>
                            <p className="text-xs font-medium text-gray-500">원문 (추출 텍스트)</p>
                            <div className="mt-1">
                              <SuggestionHighlight
                                original={result.original}
                                suggestion={result.suggestion}
                                issues={result.issues}
                                mode="original"
                              />
                            </div>
                          </div>
                          {hasChange && (
                            <div>
                              <p className="text-xs font-medium text-gray-500">AI 수정안</p>
                              <div className="mt-1">
                                <SuggestionHighlight
                                  original={result.original}
                                  suggestion={result.suggestion}
                                  issues={result.issues}
                                  mode="suggestion"
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        {pending && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => handleApproveOne(result)}
                              disabled={isBusy}
                              className="rounded-lg border border-emerald-500 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                            >
                              변경
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRejectOne(result)}
                              disabled={isBusy}
                              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                            >
                              제외
                            </button>
                          </div>
                        )}

                        {(approved || itemStatus === 'rejected') && !result.committed_to_slide && (
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={() => handleResetOne(result)}
                              disabled={isBusy}
                              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                            >
                              검토 선택 취소
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="px-4 py-3 text-xs text-gray-500">
                  {spellable.length === 0
                    ? '화면텍스트·나레이션이 없어 검사하지 않았습니다.'
                    : '검사 결과가 없습니다.'}
                </div>
              )}
            </div>
          ))}
        </div>
      )
    }

    if (checkInterrupted) {
      return (
        <div className="nb-alert nb-alert--warning text-center">
          <p className="text-sm font-medium">이전 맞춤법 검사가 중단되었습니다.</p>
          <p className="mt-1 text-xs">다시 실행해 주세요.</p>
        </div>
      )
    }

    if (checkPhase === 'error') {
      return (
        <div className="nb-alert nb-alert--error text-center">
          <p className="text-sm font-medium">맞춤법 검사에 실패했습니다.</p>
        </div>
      )
    }

    return (
      <div className="nb-empty-state">
        <p className="text-sm text-gray-500">추출된 텍스트에 대해 AI 맞춤법 검사를 실행하세요.</p>
        <p className="mt-1 text-xs text-gray-400">
          검사 후 변경·제외로 검토하고, 번역 전에 승인한 항목만 슬라이드에 일괄 적용합니다.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="nb-page-toolbar">
        <div>
          <h3 className="nb-step-title">Step 2. 맞춤법 검사</h3>
          <p className="nb-step-desc">
            추출 텍스트를 AI로 검사하고, 변경·제외로 검토한 뒤 번역 전에 슬라이드에 일괄 반영합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleRunSpelling}
            disabled={isBusy || !accessible || eligibleSlides.length === 0}
            className="nb-btn-secondary"
          >
            {isRunning && <Spinner />}
            {isRunning ? '검사 중...' : checkCompleted ? '맞춤법 검사 다시 실행' : '맞춤법 검사 실행'}
          </button>
          <button
            type="button"
            onClick={handleComplete}
            disabled={isBusy || !canCompleteReview}
            className="nb-btn-primary"
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
        <div className="nb-alert nb-alert--warning">
          {stepPrerequisiteMessage(2)}
        </div>
      )}

      {isRunning && (
        <ChunkProgressPanel
          title="맞춤법 검사"
          progress={chunkProgress}
          hint="추출된 화면텍스트·나레이션을 검사합니다. 슬라이드 원본은 변경되지 않습니다."
        />
      )}

      {lastSummary && checkPhase === 'done' && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          {lastSummary}
        </div>
      )}

      {checkCompleted && pendingReview.length > 0 && (
        <div className="nb-alert nb-alert--warning">
          검토 대기 {pendingReview.length}건 — 각 항목을 「변경」 또는 「제외」로 선택하세요.
        </div>
      )}

      {checkCompleted && reviewSettled && uncommittedApproved.length > 0 && (
        <div className="nb-alert nb-alert--warning">
          변경 선택 {uncommittedApproved.length}건 — 번역 전 「슬라이드에 일괄 적용」을 실행하세요.
        </div>
      )}

      {checkCompleted && fullyCommitted && results.length > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          검토와 슬라이드 반영이 완료되었습니다. 「검토 완료 → 번역」으로 다음 단계로 진행하세요.
        </div>
      )}

      {renderMainContent()}
    </div>
  )
}
