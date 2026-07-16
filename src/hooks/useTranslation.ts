import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { runTranslateJob } from '../lib/aiJobs'
import {
  estimateKoDurationSeconds,
  estimateTargetDurationSeconds,
  getLangConfig,
  NARRATION_FIELD_KEY,
} from '../lib/lang'
import { type ChunkProgress } from '../lib/chunkProgress'
import { supabase } from '../lib/supabase'
import type { Translation } from '../types'
import { useAuth } from './useAuth'

const translationsQueryKey = ['translations'] as const

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

/** @deprecated Step에서는 AiJobProvider.startTranslateJob 사용. 테스트·호환용 유지 */
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
    }): Promise<void> =>
      runTranslateJob(queryClient, {
        projectId,
        slideIds,
        targetLang,
        onProgress,
        onChunkProgress,
      }),
  })
}

export function useUpdateTranslation() {
  const queryClient = useQueryClient()
  const { user, profile } = useAuth()

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
        const editorName = profile?.name?.trim() || null
        const { error: logError } = await supabase.from('change_logs').insert({
          project_id: projectId,
          user_id: user?.id ?? null,
          slide_id: slideId,
          stage,
          field,
          before_value: before,
          after_value: viText,
          changed_by: editorName,
          action: stage === 'verification' ? 'verification_edited' : 'translation_edited',
          detail: `슬라이드 ${slideNum} ${field} 번역문 수정`,
          metadata: {
            slide_num: slideNum,
            field,
            before,
            after: viText,
            editor: editorName,
          },
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
