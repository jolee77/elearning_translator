import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type {
  ChangeLog,
  ExpertReview,
  ExpertReviewByTokenResult,
  ExpertReviewItem,
  ExpertReviewItemStatus,
} from '../types'
import { useAuth } from './useAuth'

const expertReviewsQueryKey = ['expert_reviews'] as const
const expertReviewItemsQueryKey = ['expert_review_items'] as const
const changeLogsQueryKey = ['change_logs'] as const

export function generateReviewToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function getReviewUrl(token: string): string {
  return `${window.location.origin}/review/${token}`
}

export function useExpertReviews(projectId: string | undefined) {
  return useQuery({
    queryKey: [...expertReviewsQueryKey, projectId],
    queryFn: async (): Promise<ExpertReview[]> => {
      const { data, error } = await supabase
        .from('expert_reviews')
        .select('*')
        .eq('project_id', projectId!)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data
    },
    enabled: !!projectId,
    refetchInterval: (query) => {
      const reviews = query.state.data
      const active = reviews?.find((r) => r.status !== 'done')
      return active ? 30_000 : false
    },
  })
}

export function useExpertReviewItems(reviewId: string | undefined, projectId?: string) {
  return useQuery({
    queryKey: [...expertReviewItemsQueryKey, reviewId, projectId],
    queryFn: async (): Promise<ExpertReviewItem[]> => {
      const { data: items, error } = await supabase
        .from('expert_review_items')
        .select('*')
        .eq('expert_review_id', reviewId!)
        .order('created_at', { ascending: true })

      if (error) throw error
      if (!items.length || !projectId) return items

      const { data: translations, error: trError } = await supabase
        .from('translations')
        .select('slide_id, field, source, vi_text')
        .eq('project_id', projectId)

      if (trError) throw trError

      const trMap = new Map(
        (translations ?? []).map((t) => [`${t.slide_id}:${t.field}`, t]),
      )

      return items.map((item) => {
        const tr = trMap.get(`${item.slide_id}:${item.field}`)
        return {
          ...item,
          source: tr?.source,
          vi_text: tr?.vi_text,
          original_vi_text: item.original_vi_text ?? tr?.vi_text,
        }
      })
    },
    enabled: !!reviewId,
  })
}

export function useChangeLogs(projectId: string | undefined) {
  return useQuery({
    queryKey: [...changeLogsQueryKey, projectId],
    queryFn: async (): Promise<ChangeLog[]> => {
      const { data, error } = await supabase
        .from('change_logs')
        .select('*')
        .eq('project_id', projectId!)
        .order('changed_at', { ascending: false })
        .limit(200)

      if (error) throw error
      return data
    },
    enabled: !!projectId,
  })
}

export function useExpertReviewByToken(token: string | undefined) {
  return useQuery({
    queryKey: ['expert_review_by_token', token],
    queryFn: async (): Promise<ExpertReviewByTokenResult> => {
      const { data, error } = await supabase.rpc('get_expert_review_by_token', {
        p_token: token!,
      })

      if (error) throw error
      return data as ExpertReviewByTokenResult
    },
    enabled: !!token,
  })
}

export interface CreateExpertReviewInput {
  projectId: string
  reviewerName: string
  reviewerEmail: string
  memo: string
}

function mapCreateExpertReviewError(message: string): string {
  if (message.includes('No translations')) {
    return '번역 데이터가 없습니다. 먼저 번역을 완료해 주세요.'
  }
  if (message.includes('Access denied') || message.includes('Authentication required')) {
    return '검증 링크를 생성할 권한이 없습니다.'
  }
  return message
}

export function useCreateExpertReview() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateExpertReviewInput): Promise<ExpertReview> => {
      const { data: review, error: reviewError } = await supabase.rpc('create_expert_review', {
        p_project_id: input.projectId,
        p_expert_name: input.reviewerName.trim(),
        p_expert_email: input.reviewerEmail.trim(),
        p_message: input.memo.trim() || null,
      })

      if (reviewError) {
        throw new Error(mapCreateExpertReviewError(reviewError.message))
      }

      if (user) {
        await supabase.from('change_logs').insert({
          project_id: input.projectId,
          user_id: user.id,
          action: 'expert_review_sent',
          detail: `전문가 검증 요청: ${input.reviewerName}`,
          metadata: {
            expert_email: input.reviewerEmail,
            token: review.token,
          },
        })
      }

      return review as ExpertReview
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['projects', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: [...expertReviewsQueryKey, variables.projectId] })
      queryClient.invalidateQueries({ queryKey: [...changeLogsQueryKey, variables.projectId] })
    },
  })
}

export function useSaveExpertReviewItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      token,
      itemId,
      status,
      viText,
      comment,
    }: {
      token: string
      itemId: string
      status: ExpertReviewItemStatus
      viText?: string
      comment?: string
    }): Promise<ExpertReviewItem> => {
      const { data, error } = await supabase.rpc('save_expert_review_item', {
        p_token: token,
        p_item_id: itemId,
        p_status: status,
        p_vi_text: viText ?? null,
        p_comment: comment ?? null,
      })

      if (error) throw error
      return data as ExpertReviewItem
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['expert_review_by_token', variables.token] })
    },
  })
}

export function useCompleteExpertReview() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ token }: { token: string }): Promise<void> => {
      const { error } = await supabase.rpc('complete_expert_review', {
        p_token: token,
      })

      if (error) throw error
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['expert_review_by_token', variables.token] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: expertReviewsQueryKey })
      queryClient.invalidateQueries({ queryKey: changeLogsQueryKey })
    },
  })
}

export function getExpertReviewStats(items: ExpertReviewItem[]) {
  const reviewed = items.filter((i) => i.status !== 'pending').length
  const pending = items.filter((i) => i.status === 'pending').length
  const changed = items.filter(
    (i) =>
      i.original_vi_text &&
      i.vi_text &&
      i.original_vi_text.trim() !== i.vi_text.trim(),
  ).length
  return { reviewed, pending, changed, total: items.length }
}
