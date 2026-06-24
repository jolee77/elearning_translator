import { useEffect, useMemo, useState } from 'react'
import { ChunkProgressPanel } from '../ui/ChunkProgressPanel'
import { Spinner } from '../ui/Spinner'
import { useToast } from '../../hooks/ToastProvider'
import { useSlides } from '../../hooks/useSlides'
import { useTranslations } from '../../hooks/useTranslation'
import {
  getMatchStatus,
  matchStatusClass,
  matchStatusLabel,
  useBulkUpdateVerificationStatus,
  useFinalizeVerification,
  useRunVerification,
  useUpdateVerificationStatus,
  useVerifications,
} from '../../hooks/useVerification'
import { isStepAccessible, stepPrerequisiteMessage } from '../../lib/projectStatus'
import type { ChunkProgress } from '../../lib/chunkProgress'
import type { Project, Verification, VerificationApplyStatus } from '../../types'

interface VerificationStepProps {
  project: Project
}

export function VerificationStep({ project }: VerificationStepProps) {
  const { showToast } = useToast()
  const { data: slides = [] } = useSlides(project.id)
  const { data: translations = [] } = useTranslations(project.id)
  const { data: verifications = [], isLoading } = useVerifications(project.id)
  const runVerification = useRunVerification()
  const updateStatus = useUpdateVerificationStatus()
  const bulkUpdateStatus = useBulkUpdateVerificationStatus()
  const finalize = useFinalizeVerification()

  const [chunkProgress, setChunkProgress] = useState<ChunkProgress | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [localStatuses, setLocalStatuses] = useState<Record<string, VerificationApplyStatus>>({})
  const [editedViTexts, setEditedViTexts] = useState<Record<string, string>>({})

  const accessible = isStepAccessible(4, project.status)
  const translationMap = useMemo(
    () => new Map(translations.map((t) => [t.id, t])),
    [translations],
  )
  const slideMap = useMemo(() => new Map(slides.map((s) => [s.id, s])), [slides])

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

  const enrichedVerifications = useMemo(() => {
    return verifications
      .map((v) => {
        const translation = translationMap.get(v.translation_id)
        const slide = slideMap.get(v.slide_id)
        return { verification: v, translation, slideNum: slide?.slide_num ?? 0 }
      })
      .sort((a, b) => a.slideNum - b.slideNum)
  }, [verifications, translationMap, slideMap])

  const pendingIds = verifications
    .filter((v) => (localStatuses[v.id] ?? v.apply_status) === 'pending')
    .map((v) => v.id)

  const handleRunVerification = async () => {
    if (!accessible) {
      showToast(stepPrerequisiteMessage(4), 'error')
      return
    }

    setIsRunning(true)
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
      setIsRunning(false)
      setChunkProgress(null)
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

  const handleBulk = async (mode: 'all_apply' | 'all_skip' | 'warn_apply') => {
    let targetIds: string[] = []
    let status: VerificationApplyStatus = 'applied'

    if (mode === 'all_apply') {
      targetIds = pendingIds
      status = 'applied'
    } else if (mode === 'all_skip') {
      targetIds = pendingIds
      status = 'skipped'
    } else {
      targetIds = verifications
        .filter((v) => {
          const current = localStatuses[v.id] ?? v.apply_status
          if (current !== 'pending') return false
          const match = getMatchStatus(v)
          return match === 'warn' || match === 'fail'
        })
        .map((v) => v.id)
      status = 'applied'
    }

    if (targetIds.length === 0) {
      showToast('처리할 항목이 없습니다.', 'info')
      return
    }

    setLocalStatuses((prev) => {
      const next = { ...prev }
      for (const id of targetIds) next[id] = status
      return next
    })

    try {
      await bulkUpdateStatus.mutateAsync({ projectId: project.id, ids: targetIds, applyStatus: status })
      showToast(`${targetIds.length}건 일괄 처리되었습니다.`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '일괄 처리에 실패했습니다.', 'error')
    }
  }

  const handleFinalize = async () => {
    if (pendingIds.length > 0) {
      showToast('아직 결정하지 않은 항목이 있습니다.', 'error')
      return
    }

    const appliedUpdates = verifications
      .filter((v) => (localStatuses[v.id] ?? v.apply_status) === 'applied')
      .map((v) => ({
        translationId: v.translation_id,
        viText: editedViTexts[v.id] ?? translationMap.get(v.translation_id)?.vi_text ?? '',
      }))
      .filter((u) => u.viText.trim())

    try {
      await finalize.mutateAsync({ projectId: project.id, appliedUpdates })
      showToast('반영이 확정되었습니다. 전문가 검증을 요청할 수 있습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '확정 처리에 실패했습니다.', 'error')
    }
  }

  const isBusy =
    isRunning ||
    runVerification.isPending ||
    updateStatus.isPending ||
    bulkUpdateStatus.isPending ||
    finalize.isPending

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Step 4. 역번역 검증</h3>
          <p className="mt-0.5 text-sm text-gray-500">
            번역문을 역번역하여 원문과 비교하고 반영 여부를 결정합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleRunVerification}
            disabled={isBusy || !accessible}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            {isRunning && <Spinner />}
            {isRunning ? '검증 중...' : '역번역 검증 실행'}
          </button>
          <button
            type="button"
            onClick={handleFinalize}
            disabled={isBusy || verifications.length === 0 || pendingIds.length > 0}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-600 disabled:opacity-50"
          >
            {finalize.isPending && <Spinner className="text-white" />}
            {finalize.isPending ? '처리 중...' : '반영 확정 → 전문가 검증 요청'}
          </button>
        </div>
      </div>

      {!accessible && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {stepPrerequisiteMessage(4)}
        </div>
      )}

      {isRunning && (
        <ChunkProgressPanel
          title="역번역 검증"
          progress={chunkProgress}
          hint="나레이션 번역을 4건씩 나누어 역번역·품질 검증합니다."
        />
      )}

      {verifications.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleBulk('all_apply')}
            disabled={isBusy || pendingIds.length === 0}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            전체 반영
          </button>
          <button
            type="button"
            onClick={() => handleBulk('all_skip')}
            disabled={isBusy || pendingIds.length === 0}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            전체 유지
          </button>
          <button
            type="button"
            onClick={() => handleBulk('warn_apply')}
            disabled={isBusy || pendingIds.length === 0}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            주의/불일치만 반영
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-16">
          <Spinner className="text-gray-400" />
          <p className="text-sm text-gray-500">검증 데이터를 불러오는 중...</p>
        </div>
      ) : verifications.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-sm text-gray-500">역번역 검증 결과가 없습니다.</p>
          <p className="mt-1 text-xs text-gray-400">
            &quot;역번역 검증 실행&quot; 버튼을 눌러 AI 검증을 시작하세요.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {enrichedVerifications.map(({ verification, translation, slideNum }) => (
            <VerificationItem
              key={verification.id}
              verification={verification}
              slideNum={slideNum}
              koText={translation?.source ?? ''}
              viText={editedViTexts[verification.id] ?? translation?.vi_text ?? ''}
              applyStatus={localStatuses[verification.id] ?? verification.apply_status}
              isBusy={isBusy}
              onApply={() => setStatus(verification.id, 'applied')}
              onSkip={() => setStatus(verification.id, 'skipped')}
              onViTextChange={(text) =>
                setEditedViTexts((prev) => ({ ...prev, [verification.id]: text }))
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface VerificationItemProps {
  verification: Verification
  slideNum: number
  koText: string
  viText: string
  applyStatus: VerificationApplyStatus
  isBusy: boolean
  onApply: () => void
  onSkip: () => void
  onViTextChange: (text: string) => void
}

function VerificationItem({
  verification,
  slideNum,
  koText,
  viText,
  applyStatus,
  isBusy,
  onApply,
  onSkip,
  onViTextChange,
}: VerificationItemProps) {
  const match = getMatchStatus(verification)

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2">
        <h4 className="text-sm font-semibold text-gray-800">슬라이드 {slideNum} · 나레이션</h4>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${matchStatusClass(match)}`}
        >
          {matchStatusLabel(match)}
          {verification.score != null && ` (${verification.score}%)`}
        </span>
      </div>
      <div className="grid gap-3 px-4 py-3 md:grid-cols-3">
        <div>
          <p className="text-xs font-medium text-gray-500">원문</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{koText}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500">번역문</p>
          {applyStatus === 'applied' ? (
            <textarea
              value={viText}
              onChange={(e) => onViTextChange(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20"
            />
          ) : (
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{viText}</p>
          )}
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500">역번역</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">
            {verification.back_translation}
          </p>
        </div>
      </div>
      {verification.issues && (
        <div className="border-t border-gray-100 bg-amber-50/50 px-4 py-2">
          <p className="text-xs font-medium text-amber-800">AI 지적사항</p>
          <p className="mt-0.5 text-sm text-amber-900">{verification.issues}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-4 py-2">
        {applyStatus === 'applied' && (
          <span className="text-xs font-medium text-emerald-600">수정 반영 선택됨</span>
        )}
        {applyStatus === 'skipped' && (
          <span className="text-xs font-medium text-gray-500">원문 유지 선택됨</span>
        )}
        {applyStatus === 'pending' && (
          <>
            <button
              type="button"
              onClick={onApply}
              disabled={isBusy}
              className="rounded-lg border border-accent px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/5 disabled:opacity-50"
            >
              수정 반영
            </button>
            <button
              type="button"
              onClick={onSkip}
              disabled={isBusy}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              원문 유지
            </button>
          </>
        )}
      </div>
    </div>
  )
}
