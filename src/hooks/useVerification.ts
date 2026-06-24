import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { verifyTranslations } from '../lib/claudeApi'
import { type ChunkProgress, mergeChunkProgress } from '../lib/chunkProgress'
import { supabase } from '../lib/supabase'
import type { Translation, Verification, VerificationApplyStatus } from '../types'
import { useAuth } from './useAuth'

const verificationsQueryKey = ['verifications'] as const
const VERIFY_BATCH_SIZE = 4

export type MatchStatus = 'ok' | 'warn' | 'fail'

export function useVerifications(projectId: string | undefined) {
  return useQuery({
    queryKey: [...verificationsQueryKey, projectId],
    queryFn: async (): Promise<Verification[]> => {
      const { data, error } = await supabase
        .from('verifications')
        .select('*')
        .eq('project_id', projectId!)
        .order('created_at', { ascending: true })

      if (error) throw error
      return data
    },
    enabled: !!projectId,
  })
}

export function useRunVerification() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      projectId,
      onProgress,
      onChunkProgress,
    }: {
      projectId: string
      onProgress?: (percent: number) => void
      onChunkProgress?: (progress: ChunkProgress) => void
    }): Promise<void> => {
      const { data: translations, error } = await supabase
        .from('translations')
        .select('id')
        .eq('project_id', projectId)
        .not('vi_text', 'is', null)
        .neq('vi_text', '')

      if (error) throw error

      const translationIds = (translations ?? []).map((row) => row.id)
      if (translationIds.length === 0) {
        throw new Error('검증할 번역이 없습니다.')
      }

      await supabase.from('projects').update({ status: 'verifying' }).eq('id', projectId)

      const batches: string[][] = []
      for (let i = 0; i < translationIds.length; i += VERIFY_BATCH_SIZE) {
        batches.push(translationIds.slice(i, i + VERIFY_BATCH_SIZE))
      }

      onChunkProgress?.(mergeChunkProgress(0, batches.length, '역번역 검증 준비'))
      onProgress?.(2)

      for (let i = 0; i < batches.length; i++) {
        onChunkProgress?.(
          mergeChunkProgress(i + 1, batches.length, '번역 항목 묶음 AI 역번역'),
        )

        await verifyTranslations(projectId, {
          translationIds: batches[i],
          resetResults: i === 0,
          finalize: i === batches.length - 1,
        })

        const percent = Math.max(5, Math.round(((i + 1) / batches.length) * 100))
        onProgress?.(percent)
      }

      onChunkProgress?.(mergeChunkProgress(batches.length, batches.length, '역번역 검증 완료'))
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['projects', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: [...verificationsQueryKey, variables.projectId] })
    },
  })
}

export function useUpdateVerificationStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      projectId: _projectId,
      applyStatus,
    }: {
      id: string
      projectId: string
      applyStatus: VerificationApplyStatus
    }): Promise<void> => {
      const { error } = await supabase
        .from('verifications')
        .update({ apply_status: applyStatus })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...verificationsQueryKey, variables.projectId] })
    },
  })
}

export function useBulkUpdateVerificationStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      projectId: _projectId,
      ids,
      applyStatus,
    }: {
      projectId: string
      ids: string[]
      applyStatus: VerificationApplyStatus
    }): Promise<void> => {
      if (ids.length === 0) return

      const { error } = await supabase
        .from('verifications')
        .update({ apply_status: applyStatus })
        .in('id', ids)

      if (error) throw error
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...verificationsQueryKey, variables.projectId] })
    },
  })
}

export function useFinalizeVerification() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      projectId,
      appliedUpdates,
    }: {
      projectId: string
      appliedUpdates: Array<{ translationId: string; viText: string }>
    }): Promise<void> => {
      for (const { translationId, viText } of appliedUpdates) {
        const { error } = await supabase
          .from('translations')
          .update({ vi_text: viText })
          .eq('id', translationId)

        if (error) throw error
      }

      if (user) {
        await supabase.from('change_logs').insert({
          project_id: projectId,
          user_id: user.id,
          action: 'verification_applied',
          detail: `${appliedUpdates.length}건 역번역 검증 반영 확정`,
          metadata: { stage: 'verification', count: appliedUpdates.length },
        })
      }

      const { error: statusError } = await supabase
        .from('projects')
        .update({ status: 'verified' })
        .eq('id', projectId)

      if (statusError) throw statusError
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['projects', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: [...translationsQueryKey, variables.projectId] })
      queryClient.invalidateQueries({ queryKey: [...verificationsQueryKey, variables.projectId] })
    },
  })
}

const translationsQueryKey = ['translations'] as const

export function getMatchStatus(verification: Verification): MatchStatus {
  const score = verification.score ?? 0
  if (score >= 90 && !verification.issues) return 'ok'
  if (score >= 70) return 'warn'
  return 'fail'
}

/** 주의·불일치만 사용자 검토가 필요 */
export function needsVerificationReview(verification: Verification): boolean {
  const match = getMatchStatus(verification)
  return match === 'warn' || match === 'fail'
}

export function isVerificationResolved(
  verification: Verification,
  applyStatus: VerificationApplyStatus,
): boolean {
  if (!needsVerificationReview(verification)) return true
  return applyStatus === 'applied' || applyStatus === 'skipped'
}

export function matchStatusLabel(status: MatchStatus): string {
  switch (status) {
    case 'ok':
      return '일치'
    case 'warn':
      return '주의'
    case 'fail':
      return '불일치'
  }
}

export function matchStatusClass(status: MatchStatus): string {
  switch (status) {
    case 'ok':
      return 'bg-emerald-100 text-emerald-800'
    case 'warn':
      return 'bg-amber-100 text-amber-800'
    case 'fail':
      return 'bg-red-100 text-red-800'
  }
}

export interface VerificationWithTranslation extends Verification {
  translation?: Translation
}
