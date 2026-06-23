import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { spellingCheck } from '../lib/claudeApi'
import { applyFieldCorrection } from '../lib/slideFields'
import { supabase } from '../lib/supabase'
import type { Slide, SpellingResult } from '../types'
import { useAuth } from './useAuth'

const spellingQueryKey = ['spelling_results'] as const
const SPELLING_BATCH_SIZE = 5

export function useSpellingResults(projectId: string | undefined) {
  return useQuery({
    queryKey: [...spellingQueryKey, projectId],
    queryFn: async (): Promise<SpellingResult[]> => {
      const { data, error } = await supabase
        .from('spelling_results')
        .select('*')
        .eq('project_id', projectId!)
        .order('created_at', { ascending: true })

      if (error) throw error
      return data
    },
    enabled: !!projectId,
  })
}

export function useRunSpellingCheck() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      projectId,
      slideIds,
      onProgress,
    }: {
      projectId: string
      slideIds: string[]
      onProgress?: (percent: number) => void
    }): Promise<void> => {
      if (slideIds.length === 0) {
        throw new Error('검사할 슬라이드가 없습니다.')
      }

      await supabase.from('projects').update({ status: 'spelling' }).eq('id', projectId)

      const batches: string[][] = []
      for (let i = 0; i < slideIds.length; i += SPELLING_BATCH_SIZE) {
        batches.push(slideIds.slice(i, i + SPELLING_BATCH_SIZE))
      }

      for (let i = 0; i < batches.length; i++) {
        await spellingCheck(projectId, batches[i])
        const percent = Math.round(((i + 1) / batches.length) * 100)
        onProgress?.(percent)
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['projects', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: [...spellingQueryKey, variables.projectId] })
    },
  })
}

export function useApplySpellingFix() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      result,
      slide,
      projectId,
    }: {
      result: SpellingResult
      slide: Slide
      projectId: string
    }): Promise<void> => {
      const updates = applyFieldCorrection(slide, result.field, result.suggestion)
      if (Object.keys(updates).length === 0) {
        throw new Error('해당 필드를 업데이트할 수 없습니다.')
      }

      const { error: slideError } = await supabase
        .from('slides')
        .update(updates)
        .eq('id', slide.id)

      if (slideError) throw slideError

      const { error: resultError } = await supabase
        .from('spelling_results')
        .update({ applied: true })
        .eq('id', result.id)

      if (resultError) throw resultError

      if (user) {
        await supabase.from('change_logs').insert({
          project_id: projectId,
          user_id: user.id,
          action: 'spelling_applied',
          detail: `슬라이드 ${slide.slide_num} ${result.field} 수정 적용`,
          metadata: { stage: 'spelling', spelling_result_id: result.id },
        })
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...spellingQueryKey, variables.projectId] })
      queryClient.invalidateQueries({ queryKey: ['slides', variables.projectId] })
    },
  })
}

export function useCompleteSpellingReview() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ projectId }: { projectId: string }): Promise<void> => {
      const { error } = await supabase
        .from('projects')
        .update({ status: 'spelling_done' })
        .eq('id', projectId)

      if (error) throw error
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['projects', variables.projectId] })
    },
  })
}

export function issueTypeLabel(type: string): string {
  switch (type) {
    case 'spelling':
    case 'spacing':
      return '맞춤법'
    case 'grammar':
      return '내용'
    case 'style':
      return '일관성'
    default:
      return '맞춤법'
  }
}

export function hasSpellingChanges(result: SpellingResult): boolean {
  return result.original.trim() !== result.suggestion.trim()
}
