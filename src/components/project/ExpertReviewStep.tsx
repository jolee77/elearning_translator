import { useState } from 'react'
import { ProgressBar } from '../ui/ProgressBar'
import { Spinner } from '../ui/Spinner'
import { useToast } from '../../hooks/ToastProvider'
import {
  getExpertReviewStats,
  getReviewUrl,
  useCreateExpertReview,
  useExpertReviewItems,
  useExpertReviews,
} from '../../hooks/useExpertReview'
import { isStepAccessible, stepPrerequisiteMessage } from '../../lib/projectStatus'
import type { Project } from '../../types'

interface ExpertReviewStepProps {
  project: Project
}

export function ExpertReviewStep({ project }: ExpertReviewStepProps) {
  const { showToast } = useToast()
  const { data: reviews = [], isLoading, refetch, isFetching } = useExpertReviews(project.id)
  const createReview = useCreateExpertReview()

  const activeReview = reviews.find((r) => r.status !== 'done') ?? reviews[0]
  const { data: items = [] } = useExpertReviewItems(activeReview?.id)

  const [reviewerName, setReviewerName] = useState('')
  const [reviewerEmail, setReviewerEmail] = useState('')
  const [memo, setMemo] = useState('')

  const accessible = isStepAccessible(5, project.status)
  const hasActiveReview = activeReview && activeReview.status !== 'done'
  const reviewUrl = activeReview ? getReviewUrl(activeReview.token) : ''
  const stats = getExpertReviewStats(items)

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
      showToast('검증 링크가 생성되었습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '링크 생성에 실패했습니다.', 'error')
    }
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(reviewUrl)
      showToast('링크가 클립보드에 복사되었습니다.', 'success')
    } catch {
      showToast('클립보드 복사에 실패했습니다.', 'error')
    }
  }

  const handleRefresh = () => {
    refetch()
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

  const isBusy = createReview.isPending || isFetching

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Step 5. 전문가 검증</h3>
          <p className="mt-0.5 text-sm text-gray-500">
            외부 전문가에게 검증 링크를 공유하여 번역 품질을 확인합니다.
          </p>
        </div>
        {hasActiveReview && (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isBusy}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            {isFetching && <Spinner />}
            {isFetching ? '새로고침 중...' : '새로고침'}
          </button>
        )}
      </div>

      {!accessible && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {stepPrerequisiteMessage(5)}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-16">
          <Spinner className="text-gray-400" />
          <p className="text-sm text-gray-500">검증 정보를 불러오는 중...</p>
        </div>
      ) : hasActiveReview ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-indigo-900">검증 링크</p>
                <p className="mt-1 break-all font-mono text-sm text-indigo-800">{reviewUrl}</p>
                <p className="mt-2 text-xs text-indigo-600">
                  전문가: {activeReview.expert_name}
                  {activeReview.expert_email && ` (${activeReview.expert_email})`}
                </p>
                {activeReview.message && (
                  <p className="mt-2 text-xs text-indigo-700">
                    <span className="font-medium">전달 메모:</span> {activeReview.message}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={handleCopyLink}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-600"
              >
                클립보드 복사
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-gray-800">
                전문가 검토 상태:{' '}
                <span className="text-accent">{reviewStatusLabel(activeReview.status)}</span>
              </p>
              {items.length > 0 && (
                <p className="text-sm text-gray-600">
                  진행률: {stats.total - stats.pending}/{stats.total} 완료
                </p>
              )}
            </div>
            {items.length > 0 && (
              <div className="mt-3">
                <ProgressBar
                  progress={Math.round(((stats.total - stats.pending) / stats.total) * 100)}
                  label={`전문가 검토 진행 (${stats.total - stats.pending}/${stats.total})`}
                />
              </div>
            )}
            <p className="mt-2 text-xs text-gray-500">
              30초마다 자동으로 상태를 확인합니다. 전문가가 검증을 완료하면 프로젝트가 완료
              단계로 이동합니다.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="reviewer-name" className="block text-sm font-medium text-gray-700">
                전문가 이름
              </label>
              <input
                id="reviewer-name"
                type="text"
                value={reviewerName}
                onChange={(e) => setReviewerName(e.target.value)}
                placeholder="홍길동"
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20"
              />
            </div>
            <div>
              <label htmlFor="reviewer-email" className="block text-sm font-medium text-gray-700">
                전문가 이메일
              </label>
              <input
                id="reviewer-email"
                type="email"
                value={reviewerEmail}
                onChange={(e) => setReviewerEmail(e.target.value)}
                placeholder="expert@example.com"
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20"
              />
            </div>
          </div>

          <div>
            <label htmlFor="reviewer-memo" className="block text-sm font-medium text-gray-700">
              메모 (전문가에게 전달할 내용)
            </label>
            <textarea
              id="reviewer-memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              rows={4}
              placeholder="검증 시 참고할 사항을 입력하세요."
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20"
            />
          </div>

          <button
            type="button"
            onClick={handleCreateLink}
            disabled={isBusy || !accessible}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-600 disabled:opacity-50"
          >
            {createReview.isPending && <Spinner className="text-white" />}
            {createReview.isPending ? '생성 중...' : '검증 링크 생성'}
          </button>
        </div>
      )}
    </div>
  )
}
