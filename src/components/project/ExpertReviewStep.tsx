import { useMemo, useState } from 'react'
import { ProgressBar } from '../ui/ProgressBar'
import { Spinner } from '../ui/Spinner'
import { useToast } from '../../hooks/ToastProvider'
import {
  getExpertReviewStats,
  getReviewUrl,
  isExpertTextChanged,
  useCreateExpertReview,
  useExpertReviewItems,
  useExpertReviews,
} from '../../hooks/useExpertReview'
import { fieldKeyLabel } from '../../lib/slideFields'
import { useSlides } from '../../hooks/useSlides'
import { isStepAccessible, stepPrerequisiteMessage } from '../../lib/projectStatus'
import type { ExpertReviewItem, Project } from '../../types'

interface ExpertReviewStepProps {
  project: Project
}

function isItemReviewed(item: ExpertReviewItem): boolean {
  return item.status !== 'pending'
}

function hasTextChange(item: ExpertReviewItem): boolean {
  return isExpertTextChanged(item.original_vi_text, item.vi_text)
}

export function ExpertReviewStep({ project }: ExpertReviewStepProps) {
  const { showToast } = useToast()
  const { data: reviews = [], isLoading, refetch, isFetching } = useExpertReviews(project.id)
  const { data: slides = [] } = useSlides(project.id)
  const createReview = useCreateExpertReview()

  // 진행 중 링크만 활성. 완료만 있으면 새 링크 생성 폼을 보여 재검증 가능하게 함
  const activeReview = reviews.find((r) => r.status !== 'done') ?? null
  const doneReviews = reviews.filter((r) => r.status === 'done')
  const latestDoneReview = doneReviews[0] ?? null
  const displayedReview = activeReview
  const reviewActive = activeReview != null
  const {
    data: items = [],
    refetch: refetchItems,
    isFetching: isFetchingItems,
  } = useExpertReviewItems(displayedReview?.id, project.id, {
    refetchInterval: reviewActive ? 30_000 : false,
  })

  const [reviewerName, setReviewerName] = useState('')
  const [reviewerEmail, setReviewerEmail] = useState('')
  const [memo, setMemo] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)

  const accessible = isStepAccessible(5, project.status)
  const needsNewLink = !activeReview
  const isCreating = needsNewLink || showCreateForm
  const reviewUrl = displayedReview ? getReviewUrl(displayedReview.token) : ''
  const doneReviewUrl = latestDoneReview ? getReviewUrl(latestDoneReview.token) : ''
  const stats = getExpertReviewStats(items)

  const slideMap = useMemo(() => new Map(slides.map((s) => [s.id, s])), [slides])

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      const slideA = slideMap.get(a.slide_id)?.slide_num ?? 0
      const slideB = slideMap.get(b.slide_id)?.slide_num ?? 0
      if (slideA !== slideB) return slideA - slideB
      return a.field.localeCompare(b.field)
    })
  }, [items, slideMap])

  const selectedItem = sortedItems.find((i) => i.id === selectedId) ?? null

  const handleCreateLink = async () => {
    if (!accessible) {
      showToast(stepPrerequisiteMessage(5), 'error')
      return
    }
    if (!reviewerName.trim()) {
      showToast('전문가 이름을 입력해 주세요.', 'error')
      return
    }
    if (!reviewerEmail.trim()) {
      showToast('전문가 이메일을 입력해 주세요.', 'error')
      return
    }

    try {
      await createReview.mutateAsync({
        projectId: project.id,
        reviewerName: reviewerName.trim(),
        reviewerEmail: reviewerEmail.trim(),
        memo: memo.trim(),
      })
      setShowCreateForm(false)
      showToast('검증 링크가 생성되었습니다. 새 링크를 전문가에게 공유해 주세요.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '링크 생성에 실패했습니다.', 'error')
    }
  }

  const handleCopyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      showToast('링크가 클립보드에 복사되었습니다.', 'success')
    } catch {
      showToast('클립보드 복사에 실패했습니다.', 'error')
    }
  }

  const handleRefresh = () => {
    void refetch()
    void refetchItems()
    showToast('상태를 새로고침했습니다.', 'info')
  }

  const reviewStatusLabel = (status: string) => {
    switch (status) {
      case 'pending':
        return '대기 중'
      case 'in_progress':
        return '검토 진행 중'
      case 'done':
        return '완료'
      default:
        return status
    }
  }

  const isBusy = createReview.isPending || isFetching || isFetchingItems

  const createForm = (
    <div className="nb-card nb-input-surface space-y-4 p-4">
      {latestDoneReview && (
        <div className="nb-alert nb-alert--warning text-sm">
          이전 전문가 검증은 이미 완료되어 수정할 수 없습니다. 재추출·재번역 후에는{' '}
          <strong>새 검증 링크</strong>를 만들어 전문가에게 다시 공유해 주세요.
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="reviewer-name" className="nb-field-label">
            전문가 이름
          </label>
          <input
            id="reviewer-name"
            type="text"
            value={reviewerName}
            onChange={(e) => setReviewerName(e.target.value)}
            placeholder="홍길동"
            className="nb-input mt-1 w-full"
          />
        </div>
        <div>
          <label htmlFor="reviewer-email" className="nb-field-label">
            전문가 이메일
          </label>
          <input
            id="reviewer-email"
            type="email"
            value={reviewerEmail}
            onChange={(e) => setReviewerEmail(e.target.value)}
            placeholder="expert@example.com"
            className="nb-input mt-1 w-full"
          />
        </div>
      </div>

      <div>
        <label htmlFor="reviewer-memo" className="nb-field-label">
          메모 (전문가에게 전달할 내용)
        </label>
        <textarea
          id="reviewer-memo"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={4}
          placeholder="검증 시 참고할 사항을 입력하세요."
          className="nb-textarea mt-1 w-full"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleCreateLink}
          disabled={isBusy || !accessible}
          className="nb-btn-primary"
        >
          {createReview.isPending && <Spinner className="text-white" />}
          {createReview.isPending ? '생성 중...' : '새 검증 링크 생성'}
        </button>
        {activeReview && showCreateForm && (
          <button
            type="button"
            onClick={() => setShowCreateForm(false)}
            disabled={isBusy}
            className="nb-btn-secondary"
          >
            취소
          </button>
        )}
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="nb-page-toolbar">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Step 5. 전문가 검증</h3>
          <p className="mt-0.5 text-sm text-gray-500">
            외부 전문가에게 검증 링크를 공유합니다. Step 3에서 제외한 항목은 번역되지 않아 링크에도
            포함되지 않습니다.
          </p>
        </div>
        {activeReview && (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isBusy}
            className="nb-btn-secondary"
          >
            {isFetching && <Spinner />}
            {isFetching ? '새로고침 중...' : '새로고침'}
          </button>
        )}
      </div>

      {!accessible && (
        <div className="nb-alert nb-alert--warning">{stepPrerequisiteMessage(5)}</div>
      )}

      {isLoading ? (
        <div className="nb-empty-state">
          <Spinner className="text-gray-400" />
          <p className="text-sm text-gray-500">검증 정보를 불러오는 중...</p>
        </div>
      ) : isCreating ? (
        <div className="space-y-4">
          {createForm}
          {latestDoneReview && (
            <div className="nb-card px-4 py-3 text-sm text-gray-600">
              <p className="font-medium text-gray-800">이전 완료 링크 (참고용·수정 불가)</p>
              <p className="mt-1 break-all font-mono text-xs text-gray-500">{doneReviewUrl}</p>
              <p className="mt-1 text-xs">
                전문가: {latestDoneReview.expert_name}
                {latestDoneReview.expert_email && ` (${latestDoneReview.expert_email})`}
              </p>
              <button
                type="button"
                onClick={() => void handleCopyLink(doneReviewUrl)}
                className="nb-btn-secondary mt-2 text-xs"
              >
                이전 링크 복사
              </button>
            </div>
          )}
        </div>
      ) : displayedReview ? (
        <div className="space-y-4">
          <div className="nb-input-panel">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold" style={{ color: '#0958d9' }}>
                  검증 링크
                </p>
                <p className="mt-1 break-all font-mono text-sm text-gray-800">{reviewUrl}</p>
                <p className="mt-2 text-xs text-gray-600">
                  전문가: {displayedReview.expert_name}
                  {displayedReview.expert_email && ` (${displayedReview.expert_email})`}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopyLink(reviewUrl)}
                  className="nb-btn-primary"
                >
                  클립보드 복사
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(true)}
                  className="nb-btn-secondary"
                >
                  새 링크 만들기
                </button>
              </div>
            </div>
          </div>

          <div className="nb-card px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-gray-800">
                검토 상태:{' '}
                <span style={{ color: '#1677ff' }}>
                  {reviewStatusLabel(displayedReview.status)}
                </span>
              </p>
              {items.length > 0 && (
                <p className="text-sm text-gray-600">
                  진행률: {stats.total - stats.pending}/{stats.total}
                  {` · 번역 수정 ${stats.changed}건`}
                </p>
              )}
            </div>
            {items.length > 0 && (
              <div className="mt-3">
                <ProgressBar
                  progress={Math.round(((stats.total - stats.pending) / stats.total) * 100)}
                  label={`전문가 검토 (${stats.total - stats.pending}/${stats.total})`}
                />
              </div>
            )}
            {items.length === 0 && (
              <p className="mt-3 text-xs text-amber-700">
                검토 항목이 없습니다. 번역이 준비되면 전문가가 링크에 접속할 때 항목이 생성됩니다.
              </p>
            )}
          </div>

          {sortedItems.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <div className="nb-card overflow-hidden">
                <div className="nb-card-header">
                  <h4 className="text-sm font-semibold">슬라이드 검토 현황</h4>
                </div>
                <div className="nb-h-scroll max-h-[60vh] overflow-y-auto">
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
                        const changed = hasTextChange(item)
                        const isSelected = item.id === selectedId

                        return (
                          <tr
                            key={item.id}
                            onClick={() => setSelectedId(item.id)}
                            className={`cursor-pointer ${isSelected ? 'bg-[#e6f4ff]' : 'hover:bg-gray-50'}`}
                          >
                            <td>{slide?.slide_num ?? '-'}</td>
                            <td>{fieldKeyLabel(item.field)}</td>
                            <td>
                              <span
                                className={`nb-badge ${isItemReviewed(item) ? 'nb-badge--success' : 'nb-badge--pending'}`}
                              >
                                {isItemReviewed(item) ? '완료' : '대기'}
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

              {selectedItem ? (
                <div className="nb-card">
                  <div className="nb-card-header">
                    <h4 className="text-sm font-semibold">
                      슬라이드 {slideMap.get(selectedItem.slide_id)?.slide_num ?? '-'}
                      {' · '}
                      {fieldKeyLabel(selectedItem.field)}
                    </h4>
                  </div>
                  <div className="space-y-3 p-4 text-sm">
                    <div>
                      <p className="nb-field-label">한국어 원문</p>
                      <p className="mt-1 whitespace-pre-wrap text-gray-800">
                        {selectedItem.source ?? '-'}
                      </p>
                    </div>
                    {selectedItem.original_vi_text && (
                      <div>
                        <p className="nb-field-label">검토 전 번역문</p>
                        <p className="mt-1 whitespace-pre-wrap text-gray-600">
                          {selectedItem.original_vi_text}
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="nb-field-label">현재 번역문</p>
                      <p
                        className={`mt-1 whitespace-pre-wrap ${
                          hasTextChange(selectedItem) ? 'font-medium text-amber-800' : 'text-gray-800'
                        }`}
                      >
                        {selectedItem.vi_text ?? '-'}
                      </p>
                    </div>
                    {selectedItem.comment && (
                      <div>
                        <p className="nb-field-label">전문가 코멘트</p>
                        <p className="mt-1 whitespace-pre-wrap text-gray-700">
                          {selectedItem.comment}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="nb-empty-state">
                  <p className="text-sm text-gray-500">표에서 항목을 선택하면 내용을 확인할 수 있습니다.</p>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        createForm
      )}
    </div>
  )
}
