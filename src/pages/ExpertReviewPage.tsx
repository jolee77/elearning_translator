import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AutoResizeTextarea } from '../components/ui/AutoResizeTextarea'
import { ProgressBar } from '../components/ui/ProgressBar'
import { Spinner } from '../components/ui/Spinner'
import { useToast } from '../hooks/ToastProvider'
import {
  getExpertReviewStats,
  isExpertTextChanged,
  useCompleteExpertReview,
  useExpertReviewByToken,
  useSaveExpertReviewItem,
} from '../hooks/useExpertReview'
import { fieldKeyLabel } from '../lib/slideFields'
import { getLangConfig } from '../lib/lang'
import type { ExpertReviewItem } from '../types'

function isItemReviewed(item: ExpertReviewItem): boolean {
  return item.status !== 'pending'
}

/** 현재 항목 이후(순환)에서 다음 미검토 항목 id. 없으면 null */
function findNextPendingId(
  items: ExpertReviewItem[],
  currentId: string,
): string | null {
  const currentIndex = items.findIndex((i) => i.id === currentId)
  if (currentIndex < 0) return null

  for (let i = currentIndex + 1; i < items.length; i++) {
    if (!isItemReviewed(items[i])) return items[i].id
  }
  for (let i = 0; i < currentIndex; i++) {
    if (!isItemReviewed(items[i])) return items[i].id
  }
  return null
}

export function ExpertReviewPage() {
  const { token } = useParams<{ token: string }>()
  const { showToast } = useToast()
  const { data, isLoading, error } = useExpertReviewByToken(token)
  const saveItem = useSaveExpertReviewItem()
  const completeReview = useCompleteExpertReview()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [localTexts, setLocalTexts] = useState<Record<string, string>>({})
  const [localComments, setLocalComments] = useState<Record<string, string>>({})
  const selectedRowRef = useRef<HTMLTableRowElement | null>(null)
  const localTextsRef = useRef(localTexts)
  const localCommentsRef = useRef(localComments)
  localTextsRef.current = localTexts
  localCommentsRef.current = localComments

  const slideMap = useMemo(
    () => new Map(data?.slides.map((s) => [s.id, s]) ?? []),
    [data?.slides],
  )

  const sortedItems = useMemo(() => {
    if (!data?.items) return []
    return [...data.items].sort((a, b) => {
      const slideA = slideMap.get(a.slide_id)?.slide_num ?? 0
      const slideB = slideMap.get(b.slide_id)?.slide_num ?? 0
      if (slideA !== slideB) return slideA - slideB
      return a.field.localeCompare(b.field)
    })
  }, [data?.items, slideMap])

  const selectedItem = sortedItems.find((i) => i.id === selectedId) ?? null
  const nextPendingId = selectedItem
    ? findNextPendingId(sortedItems, selectedItem.id)
    : null

  // 서버 항목이 새로 생길 때만 초기화 — 이미 편집 중인 초안은 덮어쓰지 않음
  useEffect(() => {
    if (!data?.items) return
    setLocalTexts((prev) => {
      const next = { ...prev }
      for (const item of data.items) {
        if (next[item.id] === undefined) {
          next[item.id] = item.vi_text ?? ''
        }
      }
      return next
    })
    setLocalComments((prev) => {
      const next = { ...prev }
      for (const item of data.items) {
        if (next[item.id] === undefined) {
          next[item.id] = item.comment ?? ''
        }
      }
      return next
    })
  }, [data?.items])

  useEffect(() => {
    if (sortedItems.length > 0 && !selectedId) {
      const firstPending = sortedItems.find((i) => !isItemReviewed(i))
      setSelectedId(firstPending?.id ?? sortedItems[0].id)
    }
  }, [sortedItems, selectedId])

  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId])

  const stats = useMemo(() => {
    const base = getExpertReviewStats(sortedItems)
    // 저장 전 로컬 초안 기준으로도 수정 건수 표시 (즉시 피드백)
    const changed = sortedItems.filter((item) => {
      const draft = localTexts[item.id] ?? item.vi_text
      return isExpertTextChanged(item.original_vi_text, draft)
    }).length
    return { ...base, changed }
  }, [sortedItems, localTexts])

  const isReviewDone = data?.review.status === 'done'
  const langName = data ? getLangConfig(data.project.target_lang).name : ''

  const handleRevertItem = async (item: ExpertReviewItem) => {
    if (!token) return

    try {
      await saveItem.mutateAsync({
        token,
        itemId: item.id,
        status: 'pending',
      })
      showToast('다시 수정할 수 있습니다.', 'info')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '되돌리기에 실패했습니다.', 'error')
    }
  }

  const handleSaveItem = async (item: ExpertReviewItem) => {
    if (!token) return

    const advanceToId = findNextPendingId(sortedItems, item.id)
    // ref로 최신 초안을 읽어 refetch/effect 타이밍에 값이 유실되지 않게 함
    const viText = localTextsRef.current[item.id] ?? item.vi_text ?? ''
    const comment = localCommentsRef.current[item.id] || undefined
    const textChanged = isExpertTextChanged(item.original_vi_text, viText)

    try {
      await saveItem.mutateAsync({
        token,
        itemId: item.id,
        status: 'reviewed',
        viText,
        comment,
      })
      // 저장한 값을 로컬에 고정 (서버 refetch가 늦어도 표시 유지)
      setLocalTexts((prev) => ({ ...prev, [item.id]: viText }))
      if (comment !== undefined) {
        setLocalComments((prev) => ({ ...prev, [item.id]: comment }))
      }
      if (advanceToId) {
        setSelectedId(advanceToId)
        showToast(
          textChanged
            ? '번역문 수정이 저장되었습니다. 다음 항목으로 이동합니다.'
            : '저장되었습니다. 다음 항목으로 이동합니다.',
          'success',
        )
      } else {
        showToast(
          textChanged
            ? '번역문 수정이 저장되었습니다. 모든 항목을 검토했습니다.'
            : '검토가 저장되었습니다. 모든 항목을 검토했습니다.',
          'success',
        )
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '저장에 실패했습니다.', 'error')
    }
  }

  const handleComplete = async () => {
    if (!token) return
    if (stats.pending > 0) {
      showToast('아직 검토하지 않은 항목이 있습니다.', 'error')
      return
    }

    try {
      await completeReview.mutateAsync({ token })
      showToast('검증이 완료되었습니다. 감사합니다!', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '완료 처리에 실패했습니다.', 'error')
    }
  }

  const selectedReviewed =
    selectedItem != null && isItemReviewed(selectedItem) && !isReviewDone

  const isBusy = saveItem.isPending || completeReview.isPending

  if (isLoading) {
    return (
      <div className="nb-login-shell">
        <Spinner className="text-gray-400" />
        <p className="text-sm text-gray-500">검증 정보를 불러오는 중...</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="nb-login-shell">
        <div className="nb-login-card w-full max-w-md p-8 text-center">
          <h2 className="text-xl font-semibold text-gray-900">유효하지 않은 링크</h2>
          <p className="mt-2 text-sm text-gray-500">
            검증 링크가 만료되었거나 올바르지 않습니다.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
          <h1 className="text-lg font-semibold" style={{ color: '#1E88E5' }}>
            전문가 검증
          </h1>
          <p className="mt-0.5 text-sm text-gray-600">{data.project.title}</p>
          <p className="text-xs text-gray-400">목표 언어: {langName}</p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6">
        {data.review.message && (
          <div className="nb-alert nb-alert--warning">
            <p className="text-xs font-medium">설계담당자 메모</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{data.review.message}</p>
          </div>
        )}

        <div className="nb-card px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-gray-800">
              진행률: {stats.total - stats.pending}/{stats.total} 완료
              {` · 번역 수정 ${stats.changed}건`}
            </p>
            {isReviewDone && (
              <span className="nb-badge nb-badge--success">검증 완료</span>
            )}
          </div>
          <div className="mt-3">
            <ProgressBar
              progress={
                stats.total > 0
                  ? Math.round(((stats.total - stats.pending) / stats.total) * 100)
                  : 0
              }
            />
          </div>
        </div>

        {sortedItems.length === 0 ? (
          <div className="nb-empty-state">
            <p className="text-sm text-gray-500">검토할 항목이 없습니다.</p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="nb-card overflow-hidden">
              <div className="nb-card-header">
                <h3 className="text-sm font-semibold">슬라이드 목록</h3>
              </div>
              <div className="nb-h-scroll max-h-[70vh] overflow-y-auto">
                <table className="nb-table">
                  <thead>
                    <tr>
                      <th>슬라이드</th>
                      <th>필드</th>
                      <th>상태</th>
                      <th>변경</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedItems.map((item) => {
                      const slide = slideMap.get(item.slide_id)
                      const reviewed = isItemReviewed(item)
                      const isSelected = item.id === selectedId
                      const draft = localTexts[item.id] ?? item.vi_text
                      const changed = isExpertTextChanged(item.original_vi_text, draft)

                      return (
                        <tr
                          key={item.id}
                          ref={isSelected ? selectedRowRef : undefined}
                          onClick={() => setSelectedId(item.id)}
                          className={`cursor-pointer ${isSelected ? 'bg-[#e6f4ff]' : 'hover:bg-gray-50'}`}
                        >
                          <td>
                            {slide?.slide_num ?? '-'}
                            {slide?.screen_num && (
                              <span className="block text-xs text-gray-400">
                                {slide.screen_num}
                              </span>
                            )}
                          </td>
                          <td>{fieldKeyLabel(item.field)}</td>
                          <td>
                            <span
                              className={`nb-badge ${reviewed ? 'nb-badge--success' : 'nb-badge--pending'}`}
                            >
                              {reviewed ? '완료' : '대기'}
                            </span>
                          </td>
                          <td>
                            {changed ? (
                              <span className="nb-badge nb-badge--warning">수정됨</span>
                            ) : (
                              <span className="text-xs text-gray-400">-</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedItem && (
              <div className="nb-card nb-input-surface">
                <div className="nb-card-header">
                  <h3 className="text-sm font-semibold">
                    슬라이드 {slideMap.get(selectedItem.slide_id)?.slide_num ?? '-'}
                    {' · '}
                    {fieldKeyLabel(selectedItem.field)}
                  </h3>
                </div>
                <div className="space-y-4 p-4">
                  <div>
                    <p className="nb-field-label">한국어 원문</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">
                      {selectedItem.source}
                    </p>
                  </div>

                  <div>
                    <p className="nb-field-label">번역문 ({langName})</p>
                    {selectedItem.original_vi_text &&
                      isExpertTextChanged(
                        selectedItem.original_vi_text,
                        localTexts[selectedItem.id] ?? selectedItem.vi_text,
                      ) && (
                        <p className="mt-1 text-xs text-amber-700">
                          검토 전 번역문과 다릅니다. 저장 시 수정 건수에 반영됩니다.
                        </p>
                      )}
                    <AutoResizeTextarea
                      value={localTexts[selectedItem.id] ?? selectedItem.vi_text ?? ''}
                      onChange={(e) =>
                        setLocalTexts((prev) => ({
                          ...prev,
                          [selectedItem.id]: e.target.value,
                        }))
                      }
                      disabled={isReviewDone || isBusy || selectedReviewed}
                      className="nb-textarea mt-1"
                    />
                  </div>

                  {selectedItem.back_translation && (
                    <div>
                      <p className="nb-field-label">역번역 (한국어)</p>
                      <p className="mt-1 whitespace-pre-wrap rounded-lg border border-[#91caff] bg-[#f0f9ff] p-3 text-sm text-gray-800">
                        {selectedItem.back_translation}
                      </p>
                    </div>
                  )}

                  <div>
                    <label className="nb-field-label">코멘트</label>
                    <AutoResizeTextarea
                      value={localComments[selectedItem.id] ?? ''}
                      onChange={(e) =>
                        setLocalComments((prev) => ({
                          ...prev,
                          [selectedItem.id]: e.target.value,
                        }))
                      }
                      disabled={isReviewDone || isBusy || selectedReviewed}
                      minRows={2}
                      placeholder="검토 의견을 입력하세요 (선택)"
                      className="nb-textarea mt-1"
                    />
                  </div>

                  {!isReviewDone && (
                    <div className="flex flex-wrap items-center gap-2">
                      {selectedReviewed ? (
                        <button
                          type="button"
                          onClick={() => handleRevertItem(selectedItem)}
                          disabled={isBusy}
                          className="nb-btn-secondary"
                        >
                          {saveItem.isPending && <Spinner />}
                          {saveItem.isPending ? '처리 중...' : '다시 수정'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSaveItem(selectedItem)}
                          disabled={isBusy}
                          className="nb-btn-primary"
                        >
                          {saveItem.isPending && <Spinner className="text-white" />}
                          {saveItem.isPending
                            ? '저장 중...'
                            : nextPendingId
                              ? '완료 → 다음'
                              : '완료'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {!isReviewDone && sortedItems.length > 0 && (
          <div className="sticky bottom-4 nb-card p-4 shadow-lg">
            <button
              type="button"
              onClick={handleComplete}
              disabled={isBusy || stats.pending > 0}
              className="nb-btn-primary w-full justify-center"
            >
              {completeReview.isPending && <Spinner className="text-white" />}
              {completeReview.isPending ? '처리 중...' : '전체 검증 완료'}
            </button>
            {stats.pending > 0 && (
              <p className="mt-2 text-center text-xs text-gray-500">
                모든 항목을 검토 완료한 후 전체 검증을 마칠 수 있습니다.
              </p>
            )}
          </div>
        )}

        {isReviewDone && (
          <div className="nb-alert nb-alert--success text-center">
            <p className="text-sm font-semibold">검증이 완료되었습니다.</p>
            <p className="mt-1 text-xs">수고하셨습니다!</p>
          </div>
        )}
      </main>
    </div>
  )
}
