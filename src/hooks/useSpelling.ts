import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { spellingCheck } from '../lib/claudeApi'
import { type ChunkProgress, mergeChunkProgress } from '../lib/chunkProgress'
import { normalizeNarration } from '../lib/pptxParser'
import { applyFieldCorrection, fieldKeyLabel } from '../lib/slideFields'
import {
  hasSpellingTextChanges,
  normalizeSpellingIssues,
} from '../lib/spellingReview'
import { supabase } from '../lib/supabase'
import type { Slide, SpellingResult } from '../types'
import { useAuth } from './useAuth'

/** useSlides와 동일 — DB text 컬럼용 JSON 직렬화 */
function prepareSlideFieldUpdatesForDb(
  updates: Partial<Pick<Slide, 'screen_text' | 'narration'>>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...updates }
  if (updates.screen_text !== undefined) {
    payload.screen_text = updates.screen_text?.length
      ? JSON.stringify(updates.screen_text)
      : null
  }
  if (updates.narration !== undefined) {
    const normalized = normalizeNarration(updates.narration)
    payload.narration = normalized?.length ? JSON.stringify(normalized) : null
  }
  return payload
}

const spellingQueryKey = ['spelling_results'] as const
/** Edge Function spelling-check BATCH_SIZE와 동일 */
const SPELLING_BATCH_SIZE = 10

function normalizeSpellingResult(row: SpellingResult & { issues?: unknown }): SpellingResult {
  return {
    ...row,
    skipped: row.skipped ?? false,
    committed_to_slide: row.committed_to_slide ?? false,
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

      const batches: string[][] = []
      for (let i = 0; i < slideIds.length; i += SPELLING_BATCH_SIZE) {
        batches.push(slideIds.slice(i, i + SPELLING_BATCH_SIZE))
      }

      let totalResults = 0
      let processedSlides = 0

      onChunkProgress?.(mergeChunkProgress(0, batches.length, '맞춤법 검사 준비'))
      onProgress?.(0)

      for (let i = 0; i < batches.length; i++) {
        const from = i * SPELLING_BATCH_SIZE + 1
        const to = Math.min((i + 1) * SPELLING_BATCH_SIZE, slideIds.length)

        onChunkProgress?.(
          mergeChunkProgress(i, batches.length, `${from}~${to}번 슬라이드 AI 검사 중`),
        )

        const result = await spellingCheck(projectId, batches[i], {
          resetResults: i === 0,
          finalize: i === batches.length - 1,
        })

        totalResults += result.result_count
        processedSlides += result.processed_slides

        const percent = Math.round(((i + 1) / batches.length) * 100)
        onChunkProgress?.(mergeChunkProgress(i + 1, batches.length, 'AI 검사'))
        onProgress?.(percent)
      }

      if (totalResults === 0) {
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

      onChunkProgress?.(mergeChunkProgress(batches.length, batches.length, '맞춤법 검사 완료'))
      onProgress?.(100)

      return {
        resultCount: totalResults,
        changeCount,
        processedSlides,
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['projects', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: [...spellingQueryKey, variables.projectId] })
    },
  })
}

async function commitSpellingResultToSlide(
  result: SpellingResult,
  slide: Slide,
  projectId: string,
  userId: string | undefined,
  editorName?: string | null,
): Promise<void> {
  const updates = applyFieldCorrection(slide, result.field, result.suggestion)
  if (Object.keys(updates).length === 0) {
    throw new Error('해당 필드를 업데이트할 수 없습니다.')
  }

  const { error: slideError } = await supabase
    .from('slides')
    .update(prepareSlideFieldUpdatesForDb(updates))
    .eq('id', slide.id)

  if (slideError) throw new Error(slideError.message)

  const { error: resultError } = await supabase
    .from('spelling_results')
    .update({ committed_to_slide: true })
    .eq('id', result.id)

  if (resultError) throw new Error(resultError.message)

  if (userId) {
    const name = editorName?.trim() || null
    const { error: logError } = await supabase.from('change_logs').insert({
      project_id: projectId,
      user_id: userId,
      slide_id: slide.id,
      stage: 'spelling',
      field: result.field,
      before_value: result.original,
      after_value: result.suggestion,
      changed_by: name,
      action: 'spelling_applied',
      detail: `슬라이드 ${slide.slide_num} ${fieldKeyLabel(result.field)} 수정 적용`,
      metadata: {
        stage: 'spelling',
        spelling_result_id: result.id,
        slide_num: slide.slide_num,
        field: result.field,
        before: result.original,
        after: result.suggestion,
        editor: name,
      },
    })

    if (logError) throw new Error(logError.message)
  }
}

async function revertSpellingResultFromSlide(
  result: SpellingResult,
  slide: Slide,
  projectId: string,
  userId: string | undefined,
  editorName?: string | null,
): Promise<void> {
  const updates = applyFieldCorrection(slide, result.field, result.original)
  if (Object.keys(updates).length === 0) {
    throw new Error('해당 필드를 복원할 수 없습니다.')
  }

  const { error: slideError } = await supabase
    .from('slides')
    .update(prepareSlideFieldUpdatesForDb(updates))
    .eq('id', slide.id)

  if (slideError) throw new Error(slideError.message)

  const { error: resultError } = await supabase
    .from('spelling_results')
    .update({ committed_to_slide: false, applied: false, skipped: false })
    .eq('id', result.id)

  if (resultError) throw new Error(resultError.message)

  if (userId) {
    const name = editorName?.trim() || null
    const { error: logError } = await supabase.from('change_logs').insert({
      project_id: projectId,
      user_id: userId,
      changed_by: name,
      action: 'spelling_reverted',
      detail: `슬라이드 ${slide.slide_num} ${fieldKeyLabel(result.field)} 맞춤법 적용 되돌림`,
      metadata: {
        stage: 'spelling',
        spelling_result_id: result.id,
        editor: name,
      },
    })

    if (logError) throw new Error(logError.message)
  }
}

/** 검토 단계: 수정안 수락 (슬라이드 미반영) */
export function useApproveSpellingFix() {
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
        .update({ applied: true, skipped: false, committed_to_slide: false })
        .in('id', resultIds)

      if (error) throw new Error(error.message)
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...spellingQueryKey, variables.projectId] })
    },
  })
}

/** 검토 단계: 수정안 제외 (슬라이드 미반영) */
export function useRejectSpellingFix() {
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
        .update({ skipped: true, applied: false, committed_to_slide: false })
        .in('id', resultIds)

      if (error) throw new Error(error.message)
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...spellingQueryKey, variables.projectId] })
    },
  })
}

/** 검토 결정 취소 (슬라이드 미반영 상태에서만) */
export function useResetSpellingReview() {
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
        .update({ applied: false, skipped: false, committed_to_slide: false })
        .in('id', resultIds)

      if (error) throw new Error(error.message)
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...spellingQueryKey, variables.projectId] })
    },
  })
}

/** 변경 선택 항목을 슬라이드에 일괄 반영 */
export function useCommitSpellingToSlides() {
  const { user, profile } = useAuth()
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
      let committed = 0

      for (const result of results) {
        if (!result.applied || result.skipped || result.committed_to_slide) continue
        const slide = slideMap.get(result.slide_id)
        if (!slide) continue
        await commitSpellingResultToSlide(
          result,
          slide,
          projectId,
          user?.id,
          profile?.name,
        )
        committed += 1
      }

      return committed
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...spellingQueryKey, variables.projectId] })
      queryClient.invalidateQueries({ queryKey: ['slides', variables.projectId] })
    },
  })
}

/** 슬라이드 반영을 되돌리고 검토 상태 초기화 */
export function useRevertSpellingCommit() {
  const { user, profile } = useAuth()
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
      let reverted = 0

      for (const result of results) {
        if (!result.committed_to_slide) continue
        const slide = slideMap.get(result.slide_id)
        if (!slide) continue
        await revertSpellingResultFromSlide(
          result,
          slide,
          projectId,
          user?.id,
          profile?.name,
        )
        reverted += 1
      }

      return reverted
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
  return hasSpellingTextChanges(result)
}

export { isSpellingPendingReview, isSpellingApproved } from '../lib/spellingReview'

export function isSpellingReviewSettled(results: SpellingResult[]): boolean {
  return results
    .filter(hasSpellingChanges)
    .every((result) => result.applied || result.skipped)
}

export function getApprovedSpellingResults(results: SpellingResult[]): SpellingResult[] {
  return results.filter(
    (result) => hasSpellingChanges(result) && result.applied && !result.skipped,
  )
}

export function getUncommittedApprovedResults(results: SpellingResult[]): SpellingResult[] {
  return getApprovedSpellingResults(results).filter((result) => !result.committed_to_slide)
}

export function getCommittedSpellingResults(results: SpellingResult[]): SpellingResult[] {
  return results.filter((result) => result.committed_to_slide)
}

export function isSpellingFullyCommitted(results: SpellingResult[]): boolean {
  return getApprovedSpellingResults(results).every((result) => result.committed_to_slide)
}

export function canCompleteSpellingReview(results: SpellingResult[]): boolean {
  return isSpellingReviewSettled(results) && isSpellingFullyCommitted(results)
}

export function isSpellingCheckComplete(status: string): boolean {
  return status === 'spelling_done'
}

export function isSpellingCheckInterrupted(status: string): boolean {
  return status === 'spelling'
}
