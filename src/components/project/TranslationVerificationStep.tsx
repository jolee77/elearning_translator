import { useEffect, useMemo, useState } from 'react'
import { AutoResizeTextarea } from '../ui/AutoResizeTextarea'
import { ChunkProgressPanel } from '../ui/ChunkProgressPanel'
import { Spinner } from '../ui/Spinner'
import { useToast } from '../../hooks/ToastProvider'
import { useSlides } from '../../hooks/useSlides'
import {
  getNarrationSpeedInfo,
  NARRATION_FIELD_KEY,
  useRunTranslation,
  useTranslations,
  useUpdateTranslation,
} from '../../hooks/useTranslation'
import {
  getMatchStatus,
  isVerificationResolved,
  matchStatusClass,
  matchStatusLabel,
  needsVerificationReview,
  useBulkUpdateVerificationStatus,
  useFinalizeVerification,
  useRunVerification,
  useUpdateVerificationStatus,
  useVerifications,
} from '../../hooks/useVerification'
import { fieldKeyLabel } from '../../lib/slideFields'
import { getLangConfig } from '../../lib/lang'
import { isStepAccessible, stepPrerequisiteMessage } from '../../lib/projectStatus'
import type { ChunkProgress } from '../../lib/chunkProgress'
import type {
  Project,
  Translation,
  Verification,
  VerificationApplyStatus,
} from '../../types'

interface TranslationVerificationStepProps {
  project: Project
  onStepComplete?: () => void
}

function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(1)}초`
}

export function TranslationVerificationStep({ project, onStepComplete }: TranslationVerificationStepProps) {
  const { showToast } = useToast()
  const { data: slides = [] } = useSlides(project.id)
  const { data: translations = [], isLoading: translationsLoading } = useTranslations(project.id)
  const { data: verifications = [], isLoading: verificationsLoading } = useVerifications(project.id)

  const runTranslation = useRunTranslation()
  const runVerification = useRunVerification()
  const updateTranslation = useUpdateTranslation()
  const updateStatus = useUpdateVerificationStatus()
  const bulkUpdateStatus = useBulkUpdateVerificationStatus()
  const finalize = useFinalizeVerification()

  const [chunkProgress, setChunkProgress] = useState<ChunkProgress | null>(null)
  const [isTranslating, setIsTranslating] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [localTexts, setLocalTexts] = useState<Record<string, string>>({})
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set())
  const [localStatuses, setLocalStatuses] = useState<Record<string, VerificationApplyStatus>>({})
  const [editedViTexts, setEditedViTexts] = useState<Record<string, string>>({})

  const accessible = isStepAccessible(3, project.status)
  const langName = getLangConfig(project.target_lang).name
  const eligibleSlides = useMemo(
    () => slides.filter((s) => s.slide_type !== 'guide'),
    [slides],
  )

  const slideMap = useMemo(() => new Map(slides.map((s) => [s.id, s])), [slides])
  const translationMap = useMemo(
    () => new Map(translations.map((t) => [t.id, t])),
    [translations],
  )
  const verificationByTranslationId = useMemo(
    () => new Map(verifications.map((v) => [v.translation_id, v])),
    [verifications],
  )

  const groupedTranslations = useMemo(() => {
    const groups = new Map<number, Translation[]>()
    for (const tr of translations) {
      const slide = slideMap.get(tr.slide_id)
      const slideNum = slide?.slide_num ?? 0
      const list = groups.get(slideNum) ?? []
      list.push(tr)
      groups.set(slideNum, list)
    }
    return [...groups.entries()].sort(([a], [b]) => a - b)
  }, [translations, slideMap])

  const getApplyStatus = (v: Verification): VerificationApplyStatus =>
    localStatuses[v.id] ?? v.apply_status

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const tr of translations) {
      next[tr.id] = localTexts[tr.id] ?? tr.vi_text
    }
    setLocalTexts(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translations])

  useEffect(() => {
    const statuses: Record<string, VerificationApplyStatus> = {}
    const texts: Record<string, string> = {}
    for (const v of verifications) {
      statuses[v.id] = localStatuses[v.id] ?? v.apply_status
      const tr = translationMap.get(v.translation_id)
      texts[v.id] = editedViTexts[v.id] ?? tr?.vi_text ?? ''
    }
    setLocalStatuses(statuses)
    setEditedViTexts(texts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifications, translations])

  const reviewSummary = useMemo(() => {
    let passed = 0
    let needsReview = 0
    let unresolved = 0
    for (const v of verifications) {
      if (needsVerificationReview(v)) {
        needsReview++
        if (!isVerificationResolved(v, getApplyStatus(v))) unresolved++
      } else {
        passed++
      }
    }
    return { passed, needsReview, unresolved }
  }, [verifications, localStatuses])

  const pendingReviewIds = verifications
    .filter(
      (v) => needsVerificationReview(v) && !isVerificationResolved(v, getApplyStatus(v)),
    )
    .map((v) => v.id)

  const handleRunTranslation = async () => {
    if (!accessible) {
      showToast(stepPrerequisiteMessage(3), 'error')
      return
    }
    setIsTranslating(true)
    setChunkProgress(null)
    try {
      await runTranslation.mutateAsync({
        projectId: project.id,
        slideIds: eligibleSlides.map((s) => s.id),
        targetLang: project.target_lang,
        onChunkProgress: setChunkProgress,
      })
      setDirtyIds(new Set())
      showToast('번역이 완료되었습니다. 역번역 검증을 실행해 주세요.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '번역에 실패했습니다.', 'error')
    } finally {
      setIsTranslating(false)
      setChunkProgress(null)
    }
  }

  const handleRunVerification = async () => {
    if (!accessible) {
      showToast(stepPrerequisiteMessage(3), 'error')
      return
    }
    if (translations.length === 0) {
      showToast('먼저 번역을 실행해 주세요.', 'error')
      return
    }
    setIsVerifying(true)
    setChunkProgress(null)
    try {
      await runVerification.mutateAsync({
        projectId: project.id,
        onChunkProgress: setChunkProgress,
      })
      showToast('역번역 검증이 완료되었습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '역번역 검증에 실패했습니다.', 'error')
    } finally {
      setIsVerifying(false)
      setChunkProgress(null)
    }
  }

  const handleTextChange = (id: string, value: string) => {
    setLocalTexts((prev) => ({ ...prev, [id]: value }))
    setDirtyIds((prev) => new Set(prev).add(id))
  }

  const handleSave = async (translation: Translation) => {
    const viText = localTexts[translation.id] ?? translation.vi_text
    try {
      await updateTranslation.mutateAsync({
        id: translation.id,
        projectId: project.id,
        viText,
        targetLang: project.target_lang,
      })
      setDirtyIds((prev) => {
        const next = new Set(prev)
        next.delete(translation.id)
        return next
      })
      showToast('번역문이 저장되었습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '저장에 실패했습니다.', 'error')
    }
  }

  const setStatus = async (id: string, status: VerificationApplyStatus) => {
    setLocalStatuses((prev) => ({ ...prev, [id]: status }))
    try {
      await updateStatus.mutateAsync({ id, projectId: project.id, applyStatus: status })
    } catch (err) {
      showToast(err instanceof Error ? err.message : '상태 변경에 실패했습니다.', 'error')
    }
  }

  const handleBulk = async (status: VerificationApplyStatus) => {
    if (pendingReviewIds.length === 0) return
    setLocalStatuses((prev) => {
      const next = { ...prev }
      for (const id of pendingReviewIds) next[id] = status
      return next
    })
    try {
      await bulkUpdateStatus.mutateAsync({
        projectId: project.id,
        ids: pendingReviewIds,
        applyStatus: status,
      })
      showToast(`${pendingReviewIds.length}건 일괄 처리되었습니다.`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '일괄 처리에 실패했습니다.', 'error')
    }
  }

  const handleComplete = async () => {
    if (dirtyIds.size > 0) {
      showToast('저장되지 않은 변경사항이 있습니다.', 'error')
      return
    }
    if (translations.length === 0) {
      showToast('번역 결과가 없습니다.', 'error')
      return
    }
    if (verifications.length === 0) {
      showToast('역번역 검증을 먼저 실행해 주세요.', 'error')
      return
    }
    const missingVerificationCount = translations.filter(
      (t) => t.vi_text?.trim() && !verificationByTranslationId.has(t.id),
    ).length
    if (missingVerificationCount > 0) {
      showToast(
        `역번역 결과가 없는 항목이 ${missingVerificationCount}건 있습니다. 역번역 검증을 다시 실행해 주세요.`,
        'error',
      )
      return
    }
    if (pendingReviewIds.length > 0) {
      showToast('주의·불일치 항목의 반영 여부를 모두 선택해 주세요.', 'error')
      return
    }

    const okPendingIds = verifications
      .filter((v) => !needsVerificationReview(v) && getApplyStatus(v) === 'pending')
      .map((v) => v.id)

    if (okPendingIds.length > 0) {
      try {
        await bulkUpdateStatus.mutateAsync({
          projectId: project.id,
          ids: okPendingIds,
          applyStatus: 'skipped',
        })
      } catch (err) {
        showToast(err instanceof Error ? err.message : '확정 처리에 실패했습니다.', 'error')
        return
      }
    }

    const appliedUpdates = verifications
      .filter((v) => getApplyStatus(v) === 'applied')
      .map((v) => ({
        translationId: v.translation_id,
        viText: editedViTexts[v.id] ?? translationMap.get(v.translation_id)?.vi_text ?? '',
      }))
      .filter((u) => u.viText.trim())

    try {
      await finalize.mutateAsync({ projectId: project.id, appliedUpdates })
      showToast('번역·역번역 검증이 완료되었습니다. 전문가 검증을 요청할 수 있습니다.', 'success')
      onStepComplete?.()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '완료 처리에 실패했습니다.', 'error')
    }
  }

  const isBusy =
    isTranslating ||
    isVerifying ||
    runTranslation.isPending ||
    runVerification.isPending ||
    updateTranslation.isPending ||
    updateStatus.isPending ||
    bulkUpdateStatus.isPending ||
    finalize.isPending

  const isLoading = translationsLoading || verificationsLoading
  const showProgress = isTranslating || isVerifying

  return (
    <div className="space-y-4">
      <div className="nb-page-toolbar">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Step 3. 번역·역번역 검증</h3>
          <p className="mt-0.5 text-sm text-gray-500">
            AI 번역 후 화면텍스트·나레이션 모두 역번역으로 품질을 확인합니다. 나레이션 싱크 마커(#1, #2…)는 유지됩니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleRunTranslation}
            disabled={isBusy || !accessible || eligibleSlides.length === 0}
            className="nb-btn-secondary"
          >
            {isTranslating && <Spinner />}
            {isTranslating ? '번역 중...' : '번역 실행'}
          </button>
          <button
            type="button"
            onClick={handleRunVerification}
            disabled={isBusy || !accessible || translations.length === 0}
            className="nb-btn-secondary"
          >
            {isVerifying && <Spinner />}
            {isVerifying ? '검증 중...' : '역번역 검증'}
          </button>
          <button
            type="button"
            onClick={handleComplete}
            disabled={
              isBusy ||
              translations.length === 0 ||
              verifications.length === 0 ||
              dirtyIds.size > 0 ||
              pendingReviewIds.length > 0
            }
            className="nb-btn-primary"
          >
            {finalize.isPending && <Spinner className="text-white" />}
            {finalize.isPending ? '처리 중...' : '완료 → 전문가 검증'}
          </button>
        </div>
      </div>

      {!accessible && (
        <div className="nb-alert nb-alert--warning">{stepPrerequisiteMessage(3)}</div>
      )}

      {verifications.length > 0 && (
        <div className="nb-summary-bar">
          <span className="font-medium text-emerald-700">
            일치 {reviewSummary.passed}건 · 자동 통과
          </span>
          {reviewSummary.needsReview > 0 && (
            <>
              <span className="text-gray-300">|</span>
              <span
                className={
                  reviewSummary.unresolved > 0
                    ? 'font-medium text-amber-700'
                    : 'text-gray-600'
                }
              >
                검토 필요 {reviewSummary.needsReview}건
                {reviewSummary.unresolved > 0 && ` (미선택 ${reviewSummary.unresolved}건)`}
              </span>
            </>
          )}
        </div>
      )}

      {verifications.length > 0 && reviewSummary.needsReview > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleBulk('applied')}
            disabled={isBusy || pendingReviewIds.length === 0}
            className="nb-btn-secondary text-xs"
          >
            검토 필요 전체 반영
          </button>
          <button
            type="button"
            onClick={() => handleBulk('skipped')}
            disabled={isBusy || pendingReviewIds.length === 0}
            className="nb-btn-secondary text-xs"
          >
            검토 필요 전체 유지
          </button>
        </div>
      )}

      {showProgress && (
        <ChunkProgressPanel
          title={isTranslating ? 'AI 번역' : '역번역 검증'}
          progress={chunkProgress}
          hint={
            isTranslating
              ? `${eligibleSlides.length}개 슬라이드를 3개씩 나누어 번역합니다.`
              : '화면텍스트·나레이션 번역을 4건씩 나누어 역번역·품질 검증합니다.'
          }
        />
      )}

      {isLoading ? (
        <div className="nb-empty-state">
          <Spinner className="text-gray-400" />
          <p className="text-sm text-gray-500">데이터를 불러오는 중...</p>
        </div>
      ) : translations.length === 0 ? (
        <div className="nb-empty-state">
          <p className="text-sm text-gray-500">번역 결과가 없습니다.</p>
          <p className="mt-1 text-xs text-gray-400">
            &quot;번역 실행&quot; 버튼을 눌러 AI 번역을 시작하세요.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedTranslations.map(([slideNum, slideTranslations]) => (
            <div key={slideNum} className="nb-card">
              <div className="nb-card-header">
                <h4 className="text-sm font-semibold text-gray-800">슬라이드 {slideNum}</h4>
              </div>
              <div className="divide-y divide-gray-100">
                {slideTranslations.map((tr) => {
                  const isNarration = tr.field === NARRATION_FIELD_KEY
                  const speedInfo = isNarration
                    ? getNarrationSpeedInfo(tr, project.target_lang)
                    : null
                  const isDirty = dirtyIds.has(tr.id)
                  const verification = verificationByTranslationId.get(tr.id)
                  const showVerificationColumn = verification != null || verifications.length > 0

                  return (
                    <div key={tr.id} className="px-4 py-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="nb-badge">{fieldKeyLabel(tr.field)}</span>
                        {isNarration && speedInfo && (
                          <span
                            className={`text-xs ${
                              speedInfo.exceeds ? 'font-medium text-red-600' : 'text-gray-500'
                            }`}
                          >
                            발화시간: 한국어 {formatSeconds(speedInfo.koSeconds)} /{' '}
                            {speedInfo.langName} {formatSeconds(speedInfo.targetSeconds)}
                            {speedInfo.exceeds && ' ⚠ 초과'}
                          </span>
                        )}
                        {verification && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${matchStatusClass(getMatchStatus(verification))}`}
                          >
                            {matchStatusLabel(getMatchStatus(verification))}
                            {verification.score != null && ` (${verification.score}%)`}
                          </span>
                        )}
                      </div>
                      <div
                        className={`grid gap-3 ${showVerificationColumn ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}
                      >
                        <div>
                          <p className="nb-field-label">한국어</p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">
                            {tr.source}
                          </p>
                        </div>
                        <div className="nb-input-panel">
                          <p className="nb-field-label">{langName}</p>
                          <AutoResizeTextarea
                            value={localTexts[tr.id] ?? tr.vi_text}
                            onChange={(e) => handleTextChange(tr.id, e.target.value)}
                            className="nb-textarea mt-1"
                          />
                          {isDirty && (
                            <button
                              type="button"
                              onClick={() => handleSave(tr)}
                              disabled={isBusy}
                              className="nb-btn-secondary mt-2 text-xs"
                            >
                              저장
                            </button>
                          )}
                        </div>
                        {verification ? (
                          <div>
                            <p className="nb-field-label">역번역</p>
                            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">
                              {verification.back_translation}
                            </p>
                            {verification.issues && (
                              <p className="mt-2 text-xs text-amber-800">
                                {verification.issues}
                              </p>
                            )}
                            {needsVerificationReview(verification) && (
                              <VerificationActions
                                verification={verification}
                                applyStatus={getApplyStatus(verification)}
                                viText={
                                  editedViTexts[verification.id] ??
                                  translationMap.get(verification.translation_id)?.vi_text ??
                                  ''
                                }
                                isBusy={isBusy}
                                onApply={() => setStatus(verification.id, 'applied')}
                                onSkip={() => setStatus(verification.id, 'skipped')}
                                onViTextChange={(text) =>
                                  setEditedViTexts((prev) => ({
                                    ...prev,
                                    [verification.id]: text,
                                  }))
                                }
                              />
                            )}
                          </div>
                        ) : showVerificationColumn ? (
                          <div>
                            <p className="nb-field-label">역번역</p>
                            <p className="mt-1 text-sm text-gray-400">
                              역번역 결과가 없습니다. 「역번역 검증」을 다시 실행해 주세요.
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function VerificationActions({
  verification,
  applyStatus,
  viText,
  isBusy,
  onApply,
  onSkip,
  onViTextChange,
}: {
  verification: Verification
  applyStatus: VerificationApplyStatus
  viText: string
  isBusy: boolean
  onApply: () => void
  onSkip: () => void
  onViTextChange: (text: string) => void
}) {
  const resolved = isVerificationResolved(verification, applyStatus)

  if (resolved) {
    return (
      <p className="mt-2 text-xs font-medium text-gray-500">
        {applyStatus === 'applied' ? '수정 반영 선택됨' : '번역문 유지 선택됨'}
      </p>
    )
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="text-xs text-amber-700">반영 여부 선택</span>
      <button
        type="button"
        onClick={onApply}
        disabled={isBusy}
        className="nb-btn-secondary text-xs"
      >
        수정 반영
      </button>
      <button
        type="button"
        onClick={onSkip}
        disabled={isBusy}
        className="nb-btn-secondary text-xs"
      >
        번역문 유지
      </button>
      {applyStatus === 'applied' && (
        <AutoResizeTextarea
          value={viText}
          onChange={(e) => onViTextChange(e.target.value)}
          className="nb-textarea mt-1 w-full"
        />
      )}
    </div>
  )
}
