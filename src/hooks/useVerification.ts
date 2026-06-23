import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { verifyTranslations } from '../lib/claudeApi'
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

export function useRunVerification() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      projectId,
      onProgress,
    }: {
      projectId: string
      onProgress?: (percent: number) => void
    }): Promise<void> => {
      onProgress?.(10)
      await supabase.from('projects').update({ status: 'verifying' }).eq('id', projectId)
      onProgress?.(30)
      await verifyTranslations(projectId)
      onProgress?.(100)
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
  const score = verification.similarity_score ?? 0
  if (score >= 90 && !verification.issues) return 'ok'
  if (score >= 70) return 'warn'
  return 'fail'
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
