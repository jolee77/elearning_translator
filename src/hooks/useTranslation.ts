import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { translateSlides } from '../lib/claudeApi'
import {
  estimateKoDurationSeconds,
  estimateTargetDurationSeconds,
  getLangConfig,
  NARRATION_FIELD_KEY,
} from '../lib/lang'
import { supabase } from '../lib/supabase'
import type { Translation } from '../types'

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
    }: {
      projectId: string
      slideIds: string[]
      targetLang: string
      onProgress?: (percent: number) => void
    }): Promise<void> => {
      if (slideIds.length === 0) {
        throw new Error('번역할 슬라이드가 없습니다.')
      }

      await supabase.from('projects').update({ status: 'translating' }).eq('id', projectId)

      const batches: string[][] = []
      for (let i = 0; i < slideIds.length; i += TRANSLATE_BATCH_SIZE) {
        batches.push(slideIds.slice(i, i + TRANSLATE_BATCH_SIZE))
      }

      for (let i = 0; i < batches.length; i++) {
        await translateSlides(projectId, batches[i], targetLang)
        const percent = Math.round(((i + 1) / batches.length) * 100)
        onProgress?.(percent)
      }
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

  return useMutation({
    mutationFn: async ({
      id,
      projectId: _projectId,
      viText,
      targetLang: _targetLang,
    }: {
      id: string
      projectId: string
      viText: string
      targetLang: string
    }): Promise<Translation> => {
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
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...translationsQueryKey, variables.projectId] })
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
