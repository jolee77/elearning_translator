import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { spellingCheck } from '../lib/claudeApi'
import { type ChunkProgress, mergeChunkProgress } from '../lib/chunkProgress'
import { applyFieldCorrection } from '../lib/slideFields'
import {
  hasSpellingTextChanges,
  normalizeSpellingIssues,
} from '../lib/spellingReview'
import { supabase } from '../lib/supabase'
import type { Slide, SpellingResult } from '../types'
import { useAuth } from './useAuth'

const spellingQueryKey = ['spelling_results'] as const

function normalizeSpellingResult(row: SpellingResult & { issues?: unknown }): SpellingResult {
  return {
    ...row,
    skipped: row.skipped ?? false,
    issues: normalizeSpellingIssues(row.issues),
  }
}

export interface SpellingCheckSummary {
  resultCount: number
  changeCount: number
  processedSlides: number
}

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
      return (data ?? []).map((row) => normalizeSpellingResult(row as SpellingResult))
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
      onChunkProgress,
    }: {
      projectId: string
      slideIds: string[]
      onProgress?: (percent: number) => void
      onChunkProgress?: (progress: ChunkProgress) => void
    }): Promise<SpellingCheckSummary> => {
      if (slideIds.length === 0) {
        throw new Error('검사할 슬라이드가 없습니다.')
      }

      const { error: statusError } = await supabase
        .from('projects')
        .update({ status: 'spelling' })
        .eq('id', projectId)

      if (statusError) throw statusError

      onChunkProgress?.(
        mergeChunkProgress(0, 1, `${slideIds.length}개 슬라이드 AI 검사 중`),
      )
      onProgress?.(5)

      const result = await spellingCheck(projectId, slideIds, {
        resetResults: true,
        finalize: true,
      })

      onProgress?.(95)

      if (result.result_count === 0) {
        throw new Error(
          '맞춤법 검사 결과가 저장되지 않았습니다. 추출된 화면 텍스트·나레이션이 있는지 확인해 주세요.',
        )
      }

      await queryClient.invalidateQueries({
        queryKey: [...spellingQueryKey, projectId],
      })
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      await queryClient.invalidateQueries({ queryKey: ['projects', projectId] })

      const results = await queryClient.fetchQuery({
        queryKey: [...spellingQueryKey, projectId],
        queryFn: async (): Promise<SpellingResult[]> => {
          const { data, error } = await supabase
            .from('spelling_results')
            .select('*')
            .eq('project_id', projectId)
            .order('created_at', { ascending: true })

          if (error) throw error
          return (data ?? []).map((row) => normalizeSpellingResult(row as SpellingResult))
        },
      })
      const changeCount = results.filter(hasSpellingTextChanges).length

      onChunkProgress?.(mergeChunkProgress(1, 1, '맞춤법 검사 완료'))

      return {
        resultCount: result.result_count,
        changeCount,
        processedSlides: result.processed_slides,
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['projects', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: [...spellingQueryKey, variables.projectId] })
    },
  })
}

async function applySpellingResultToSlide(
  result: SpellingResult,
  slide: Slide,
  projectId: string,
  userId: string | undefined,
): Promise<void> {
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
    .update({ applied: true, skipped: false })
    .eq('id', result.id)

  if (resultError) throw resultError

  if (userId) {
    const { error: logError } = await supabase.from('change_logs').insert({
      project_id: projectId,
      user_id: userId,
      action: 'spelling_applied',
      detail: `슬라이드 ${slide.slide_num} ${result.field} 수정 적용`,
      metadata: { stage: 'spelling', spelling_result_id: result.id },
    })

    if (logError) throw logError
  }
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
      await applySpellingResultToSlide(result, slide, projectId, user?.id)
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...spellingQueryKey, variables.projectId] })
      queryClient.invalidateQueries({ queryKey: ['slides', variables.projectId] })
    },
  })
}

export function useBulkApplySpellingFix() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      results,
      slides,
      projectId,
    }: {
      results: SpellingResult[]
      slides: Slide[]
      projectId: string
    }): Promise<number> => {
      const slideMap = new Map(slides.map((s) => [s.id, s]))
      let applied = 0

      for (const result of results) {
        const slide = slideMap.get(result.slide_id)
        if (!slide) continue
        await applySpellingResultToSlide(result, slide, projectId, user?.id)
        applied += 1
      }

      return applied
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...spellingQueryKey, variables.projectId] })
      queryClient.invalidateQueries({ queryKey: ['slides', variables.projectId] })
    },
  })
}

export function useSkipSpellingFix() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      resultIds,
      projectId: _projectId,
    }: {
      resultIds: string[]
      projectId: string
    }): Promise<void> => {
      if (resultIds.length === 0) return

      const { error } = await supabase
        .from('spelling_results')
        .update({ skipped: true })
        .in('id', resultIds)

      if (error) throw error
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...spellingQueryKey, variables.projectId] })
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
  return hasSpellingTextChanges(result)
}

export { isSpellingPendingReview } from '../lib/spellingReview'

export function isSpellingReviewSettled(results: SpellingResult[]): boolean {
  return results
    .filter(hasSpellingChanges)
    .every((result) => result.applied || result.skipped)
}

export function isSpellingCheckComplete(status: string): boolean {
  return status === 'spelling_done'
}

export function isSpellingCheckInterrupted(status: string): boolean {
  return status === 'spelling'
}
