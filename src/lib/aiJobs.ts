import type { QueryClient } from '@tanstack/react-query'
import { spellingCheck, translateSlides, verifyTranslations } from './claudeApi'
import { type ChunkProgress, mergeChunkProgress } from './chunkProgress'
import { hasSpellingTextChanges, normalizeSpellingIssues } from './spellingReview'
import { supabase } from './supabase'
import type { SpellingResult } from '../types'

export type AiJobKind = 'spelling' | 'translate' | 'verify'

export const AI_JOB_LABELS: Record<AiJobKind, string> = {
  spelling: '맞춤법 검사',
  translate: '번역',
  verify: '역번역 검증',
}

export function makeAiJobKey(projectId: string, kind: AiJobKind): string {
  return `${projectId}:${kind}`
}

/** Edge Function BATCH_SIZE와 동일 */
export const SPELLING_BATCH_SIZE = 10
export const TRANSLATE_BATCH_SIZE = 3
export const VERIFY_BATCH_SIZE = 4

const spellingQueryKey = ['spelling_results'] as const
const translationsQueryKey = ['translations'] as const
const verificationsQueryKey = ['verifications'] as const

export interface SpellingCheckSummary {
  resultCount: number
  changeCount: number
  processedSlides: number
}

function normalizeSpellingResult(row: SpellingResult & { issues?: unknown }): SpellingResult {
  return {
    ...row,
    skipped: row.skipped ?? false,
    committed_to_slide: row.committed_to_slide ?? false,
    issues: normalizeSpellingIssues(row.issues),
  }
}

export interface AiJobProgressCallbacks {
  onProgress?: (percent: number) => void
  onChunkProgress?: (progress: ChunkProgress) => void
}

export async function runSpellingJob(
  queryClient: QueryClient,
  {
    projectId,
    slideIds,
    onProgress,
    onChunkProgress,
  }: {
    projectId: string
    slideIds: string[]
  } & AiJobProgressCallbacks,
): Promise<SpellingCheckSummary> {
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

  await queryClient.invalidateQueries({ queryKey: [...spellingQueryKey, projectId] })
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
}

export async function runTranslateJob(
  queryClient: QueryClient,
  {
    projectId,
    slideIds,
    targetLang,
    onProgress,
    onChunkProgress,
  }: {
    projectId: string
    slideIds: string[]
    targetLang: string
  } & AiJobProgressCallbacks,
): Promise<void> {
  if (slideIds.length === 0) {
    throw new Error('번역할 슬라이드가 없습니다.')
  }

  await supabase.from('projects').update({ status: 'translating' }).eq('id', projectId)

  const batches: string[][] = []
  for (let i = 0; i < slideIds.length; i += TRANSLATE_BATCH_SIZE) {
    batches.push(slideIds.slice(i, i + TRANSLATE_BATCH_SIZE))
  }

  onChunkProgress?.(mergeChunkProgress(0, batches.length, '번역 준비'))

  for (let i = 0; i < batches.length; i++) {
    onChunkProgress?.(mergeChunkProgress(i + 1, batches.length, '슬라이드 묶음 AI 번역'))

    await translateSlides(projectId, batches[i], targetLang, {
      resetResults: i === 0,
      finalize: i === batches.length - 1,
    })

    const percent = Math.round(((i + 1) / batches.length) * 100)
    onProgress?.(percent)
  }

  onChunkProgress?.(mergeChunkProgress(batches.length, batches.length, '번역 완료'))

  await queryClient.invalidateQueries({ queryKey: ['projects'] })
  await queryClient.invalidateQueries({ queryKey: ['projects', projectId] })
  await queryClient.invalidateQueries({ queryKey: [...translationsQueryKey, projectId] })
}

export async function runVerifyJob(
  queryClient: QueryClient,
  {
    projectId,
    onProgress,
    onChunkProgress,
  }: {
    projectId: string
  } & AiJobProgressCallbacks,
): Promise<void> {
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
    onChunkProgress?.(mergeChunkProgress(i + 1, batches.length, '번역 항목 묶음 AI 역번역'))

    await verifyTranslations(projectId, {
      translationIds: batches[i],
      resetResults: i === 0,
      finalize: i === batches.length - 1,
    })

    const percent = Math.max(5, Math.round(((i + 1) / batches.length) * 100))
    onProgress?.(percent)
  }

  onChunkProgress?.(mergeChunkProgress(batches.length, batches.length, '역번역 검증 완료'))

  await queryClient.invalidateQueries({ queryKey: ['projects'] })
  await queryClient.invalidateQueries({ queryKey: ['projects', projectId] })
  await queryClient.invalidateQueries({ queryKey: [...verificationsQueryKey, projectId] })
}
