import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { translateSlides } from '../lib/claudeApi'
import {
  estimateKoDurationSeconds,
  estimateTargetDurationSeconds,
  getLangConfig,
  NARRATION_FIELD_KEY,
} from '../lib/lang'
import { type ChunkProgress, mergeChunkProgress } from '../lib/chunkProgress'
import { supabase } from '../lib/supabase'
import type { Translation } from '../types'
import { useAuth } from './useAuth'

const translationsQueryKey = ['translations'] as const
const TRANSLATE_BATCH_SIZE = 3

function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

function calcTargetWpm(text: string): number {
  return countWords(text)
}

export function useTranslations(projectId: string | undefined) {
  return useQuery({
    queryKey: [...translationsQueryKey, projectId],
    queryFn: async (): Promise<Translation[]> => {
      const { data, error } = await supabase
        .from('translations')
        .select('*')
        .eq('project_id', projectId!)
        .order('created_at', { ascending: true })

      if (error) throw error
      return data
    },
    enabled: !!projectId,
  })
}

export function useRunTranslation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      projectId,
      slideIds,
      targetLang,
      onProgress,
      onChunkProgress,
    }: {
      projectId: string
      slideIds: string[]
      targetLang: string
      onProgress?: (percent: number) => void
      onChunkProgress?: (progress: ChunkProgress) => void
    }): Promise<void> => {
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
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['projects', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: [...translationsQueryKey, variables.projectId] })
    },
  })
}

export function useUpdateTranslation() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: async ({
      id,
      projectId,
      viText,
      targetLang: _targetLang,
      stage,
      slideId,
      slideNum,
      field,
    }: {
      id: string
      projectId: string
      viText: string
      targetLang: string
      stage: 'translation' | 'verification'
      slideId: string
      slideNum: number
      field: string
    }): Promise<Translation> => {
      const { data: current, error: currentError } = await supabase
        .from('translations')
        .select('vi_text')
        .eq('id', id)
        .single()

      if (currentError) throw currentError

      const before = current?.vi_text ?? ''

      const { data, error } = await supabase
        .from('translations')
        .update({
          vi_text: viText,
          vi_wpm: calcTargetWpm(viText),
        })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error

      if (before.trim() !== viText.trim()) {
        const { error: logError } = await supabase.from('change_logs').insert({
          project_id: projectId,
          user_id: user?.id ?? null,
          slide_id: slideId,
          stage,
          field,
          before_value: before,
          after_value: viText,
          action: stage === 'verification' ? 'verification_edited' : 'translation_edited',
          detail: `슬라이드 ${slideNum} ${field} 번역문 수정`,
          metadata: { slide_num: slideNum, field, before, after: viText },
        })
        if (logError) throw logError
      }

      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...translationsQueryKey, variables.projectId] })
      queryClient.invalidateQueries({ queryKey: ['change_logs', variables.projectId] })
    },
  })
}

export function useCompleteTranslation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ projectId }: { projectId: string }): Promise<void> => {
      const { error } = await supabase
        .from('projects')
        .update({ status: 'translated' })
        .eq('id', projectId)

      if (error) throw error
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['projects', variables.projectId] })
    },
  })
}

export function getNarrationSpeedInfo(translation: Translation, targetLang: string) {
  const koSeconds = estimateKoDurationSeconds(translation.source)
  const targetSeconds = estimateTargetDurationSeconds(translation.vi_text, targetLang)
  const exceeds = targetSeconds > koSeconds && koSeconds > 0

  return {
    koSeconds,
    targetSeconds,
    exceeds,
    langName: getLangConfig(targetLang).name,
  }
}

export { NARRATION_FIELD_KEY }
