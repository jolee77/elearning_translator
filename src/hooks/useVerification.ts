import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { runVerifyJob } from '../lib/aiJobs'
import { type ChunkProgress } from '../lib/chunkProgress'
import { supabase } from '../lib/supabase'
import type { Translation, Verification, VerificationApplyStatus } from '../types'
import { useAuth } from './useAuth'

const verificationsQueryKey = ['verifications'] as const

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

/** @deprecated Step에서는 AiJobProvider.startVerifyJob 사용. 테스트·호환용 유지 */
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
    }): Promise<void> =>
      runVerifyJob(queryClient, { projectId, onProgress, onChunkProgress }),
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
    mutationFn: async ({ projectId }: { projectId: string }): Promise<void> => {
      if (user) {
        await supabase.from('change_logs').insert({
          project_id: projectId,
          user_id: user.id,
          action: 'verification_applied',
          detail: '번역·역번역 검증 단계 완료',
          metadata: { stage: 'verification' },
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

/** 주의·불일치 항목 (전문가 검증 참고용) */
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
