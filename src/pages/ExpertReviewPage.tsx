import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ProgressBar } from '../components/ui/ProgressBar'
import { Spinner } from '../components/ui/Spinner'
import { useToast } from '../hooks/ToastProvider'
import {
  getExpertReviewStats,
  useCompleteExpertReview,
  useExpertReviewByToken,
  useSaveExpertReviewItem,
} from '../hooks/useExpertReview'
import { fieldKeyLabel } from '../lib/slideFields'
import { getLangConfig } from '../lib/lang'
import type { ExpertReviewItem, ExpertReviewItemStatus } from '../types'

export function ExpertReviewPage() {
  const { token } = useParams<{ token: string }>()
  const { showToast } = useToast()
  const { data, isLoading, error } = useExpertReviewByToken(token)
  const saveItem = useSaveExpertReviewItem()
  const completeReview = useCompleteExpertReview()

  const [localTexts, setLocalTexts] = useState<Record<string, string>>({})
  const [localComments, setLocalComments] = useState<Record<string, string>>({})

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
      return a.field_key.localeCompare(b.field_key)
    })
  }, [data?.items, slideMap])

  useEffect(() => {
    if (!data?.items) return
    const texts: Record<string, string> = {}
    const comments: Record<string, string> = {}
    for (const item of data.items) {
      texts[item.id] = localTexts[item.id] ?? item.vi_text
      comments[item.id] = localComments[item.id] ?? item.comment ?? ''
    }
    setLocalTexts(texts)
    setLocalComments(comments)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.items])

  const stats = getExpertReviewStats(sortedItems)
  const isReviewDone = data?.review.status === 'done'
  const langName = data ? getLangConfig(data.project.target_lang).name : ''

  const handleSaveItem = async (item: ExpertReviewItem, status: ExpertReviewItemStatus) => {
    if (!token) return

    try {
      await saveItem.mutateAsync({
        token,
        itemId: item.id,
        status,
        viText: localTexts[item.id] ?? item.vi_text,
        comment: localComments[item.id] || undefined,
      })
      showToast(status === 'approved' ? '승인되었습니다.' : '수정이 반영되었습니다.', 'success')
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

  const isBusy = saveItem.isPending || completeReview.isPending

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 bg-gray-50 p-6">
        <Spinner className="text-gray-400" />
        <p className="text-sm text-gray-500">검증 정보를 불러오는 중...</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md rounded-xl bg-white p-8 text-center shadow-sm">
          <h2 className="text-xl font-semibold text-gray-900">유효하지 않은 링크</h2>
          <p className="mt-2 text-sm text-gray-500">
            검증 링크가 만료되었거나 올바르지 않습니다.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6">
          <h1 className="text-lg font-semibold text-primary">전문가 검증</h1>
          <p className="mt-0.5 text-sm text-gray-600">{data.project.title}</p>
          <p className="text-xs text-gray-400">목표 언어: {langName}</p>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 px-4 py-6 sm:px-6">
        {data.review.memo && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-xs font-medium text-amber-800">설계담당자 메모</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-amber-900">{data.review.memo}</p>
          </div>
        )}

        <div className="rounded-xl border border-gray-200 bg-white px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-gray-800">
              진행률: {stats.total - stats.pending}/{stats.total} 완료
            </p>
            {isReviewDone && (
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                검증 완료
              </span>
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

        <div className="space-y-3">
          {sortedItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
              <p className="text-sm text-gray-500">검토할 항목이 없습니다.</p>
            </div>
          ) : (
            sortedItems.map((item) => {
            const slide = slideMap.get(item.slide_id)
            const isDone = item.status !== 'pending'

            return (
              <div
                key={item.id}
                className={`overflow-hidden rounded-xl border bg-white shadow-sm ${
                  isDone ? 'border-emerald-200' : 'border-gray-200'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2">
                  <h3 className="text-sm font-semibold text-gray-800">
                    슬라이드 {slide?.slide_num ?? '-'}
                    {slide?.screen_num && ` (${slide.screen_num})`}
                    {' · '}
                    {fieldKeyLabel(item.field_key)}
                  </h3>
                  {isDone && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        item.status === 'approved'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {item.status === 'approved' ? '승인' : '수정완료'}
                    </span>
                  )}
                </div>

                <div className="grid gap-4 px-4 py-3 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium text-gray-500">한국어 원문</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{item.ko_text}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500">번역문 ({langName})</p>
                    <textarea
                      value={localTexts[item.id] ?? item.vi_text}
                      onChange={(e) =>
                        setLocalTexts((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      disabled={isReviewDone || isBusy}
                      rows={4}
                      className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 disabled:bg-gray-50"
                    />
                  </div>
                </div>

                <div className="border-t border-gray-100 px-4 py-3">
                  <label className="text-xs font-medium text-gray-500">코멘트</label>
                  <textarea
                    value={localComments[item.id] ?? ''}
                    onChange={(e) =>
                      setLocalComments((prev) => ({ ...prev, [item.id]: e.target.value }))
                    }
                    disabled={isReviewDone || isBusy}
                    rows={2}
                    placeholder="검토 의견을 입력하세요 (선택)"
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 disabled:bg-gray-50"
                  />
                </div>

                {!isReviewDone && (
                  <div className="flex flex-wrap gap-2 border-t border-gray-100 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleSaveItem(item, 'approved')}
                      disabled={isBusy || isDone}
                      className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                    >
                      승인
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveItem(item, 'rejected')}
                      disabled={isBusy || isDone}
                      className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                    >
                      수정완료
                    </button>
                  </div>
                )}
              </div>
            )
          })
          )}
        </div>

        {!isReviewDone && sortedItems.length > 0 && (
          <div className="sticky bottom-4 rounded-xl border border-gray-200 bg-white p-4 shadow-lg">
            <button
              type="button"
              onClick={handleComplete}
              disabled={isBusy || stats.pending > 0}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
            >
              {completeReview.isPending && <Spinner className="text-white" />}
              {completeReview.isPending ? '처리 중...' : '검증 완료'}
            </button>
            {stats.pending > 0 && (
              <p className="mt-2 text-center text-xs text-gray-500">
                모든 항목을 승인 또는 수정완료 처리한 후 검증을 완료할 수 있습니다.
              </p>
            )}
          </div>
        )}

        {isReviewDone && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-center">
            <p className="text-sm font-semibold text-emerald-800">검증이 완료되었습니다.</p>
            <p className="mt-1 text-xs text-emerald-600">수고하셨습니다!</p>
          </div>
        )}
      </main>
    </div>
  )
}
