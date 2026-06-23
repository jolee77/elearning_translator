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

export function useExpertReviewItems(reviewId: string | undefined) {
  return useQuery({
    queryKey: [...expertReviewItemsQueryKey, reviewId],
    queryFn: async (): Promise<ExpertReviewItem[]> => {
      const { data, error } = await supabase
        .from('expert_review_items')
        .select('*')
        .eq('expert_review_id', reviewId!)
        .order('created_at', { ascending: true })

      if (error) throw error
      return data
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
        .order('created_at', { ascending: false })
        .limit(30)

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

export function useCreateExpertReview() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateExpertReviewInput): Promise<ExpertReview> => {
      const { data: translations, error: trError } = await supabase
        .from('translations')
        .select('*')
        .eq('project_id', input.projectId)
        .order('created_at', { ascending: true })

      if (trError) throw trError
      if (!translations?.length) {
        throw new Error('번역 데이터가 없습니다. 먼저 번역을 완료해 주세요.')
      }

      const token = generateReviewToken()

      const { data: review, error: reviewError } = await supabase
        .from('expert_reviews')
        .insert({
          project_id: input.projectId,
          token,
          status: 'pending',
          reviewer_name: input.reviewerName.trim(),
          reviewer_email: input.reviewerEmail.trim(),
          memo: input.memo.trim() || null,
        })
        .select()
        .single()

      if (reviewError) throw reviewError

      const items = translations.map((t) => ({
        expert_review_id: review.id,
        slide_id: t.slide_id,
        translation_id: t.id,
        field_key: t.field_key,
        ko_text: t.ko_text,
        vi_text: t.vi_text,
        status: 'pending' as const,
      }))

      const { error: itemsError } = await supabase.from('expert_review_items').insert(items)
      if (itemsError) throw itemsError

      const { error: statusError } = await supabase
        .from('projects')
        .update({ status: 'expert_review' })
        .eq('id', input.projectId)

      if (statusError) throw statusError

      if (user) {
        await supabase.from('change_logs').insert({
          project_id: input.projectId,
          user_id: user.id,
          action: 'expert_review_sent',
          detail: `전문가 검증 요청: ${input.reviewerName}`,
          metadata: {
            reviewer_email: input.reviewerEmail,
            token,
          },
        })
      }

      return review
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
  const approved = items.filter((i) => i.status === 'approved').length
  const modified = items.filter((i) => i.status === 'rejected').length
  const pending = items.filter((i) => i.status === 'pending').length
  return { approved, modified, pending, total: items.length }
}
