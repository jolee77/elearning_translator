import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  parsePptx,
  normalizeNarration,
  normalizeScreenText,
  type ParseProgress,
  type ParsedSlide,
} from '../lib/pptxParser'
import { supabase } from '../lib/supabase'
import type { Slide } from '../types'
import { STORAGE_BUCKET } from './useProject'
import { useAuth } from './useAuth'

const slidesQueryKey = ['slides'] as const
const INSERT_BATCH_SIZE = 25

export type { ParseProgress }

export type SlideInsert = Omit<Slide, 'id' | 'created_at'>
export type SlideUpdate = Partial<
  Omit<Slide, 'id' | 'project_id' | 'slide_num' | 'created_at'>
>

function normalizeSlide(slide: Slide): Slide {
  return {
    ...slide,
    screen_text: normalizeScreenText(slide.screen_text),
    narration: normalizeNarration(slide.narration),
  }
}

function normalizeSlides(slides: Slide[]): Slide[] {
  return slides.map(normalizeSlide)
}

function serializeScreenTextForDb(boxes: Slide['screen_text']): string | null {
  if (!boxes?.length) return null
  return JSON.stringify(boxes)
}

function serializeNarrationForDb(boxes: Slide['narration']): string | null {
  const normalized = normalizeNarration(boxes)
  if (!normalized?.length) return null
  return JSON.stringify(normalized)
}

export function useSlides(projectId: string | undefined) {
  return useQuery({
    queryKey: [...slidesQueryKey, projectId],
    queryFn: async (): Promise<Slide[]> => {
      const { data, error } = await supabase
        .from('slides')
        .select('*')
        .eq('project_id', projectId!)
        .order('slide_num', { ascending: true })

      if (error) throw error
      return normalizeSlides(data)
    },
    enabled: !!projectId,
  })
}

async function downloadPptx(storagePath: string): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(storagePath)
  if (error) throw error
  return data.arrayBuffer()
}

function toSlideRows(projectId: string, parsed: ParsedSlide[]): SlideInsert[] {
  return parsed.map((slide) => ({
    project_id: projectId,
    slide_num: slide.slide_num,
    slide_type: slide.slide_type,
    screen_num: slide.screen_num,
    course_name: slide.course_name,
    chapter_name: slide.chapter_name,
    current_section: slide.current_section,
    screen_text: serializeScreenTextForDb(slide.screen_text) as unknown as SlideInsert['screen_text'],
    screen_desc: slide.screen_desc,
    image_nums: slide.image_nums,
    narration: serializeNarrationForDb(slide.narration) as unknown as SlideInsert['narration'],
  }))
}

async function insertSlideRows(
  rows: SlideInsert[],
  onProgress?: (progress: ParseProgress) => void,
): Promise<Slide[]> {
  const inserted: Slide[] = []
  const total = rows.length

  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE)
    const { data, error } = await supabase.from('slides').insert(batch).select()

    if (error) throw error
    inserted.push(...normalizeSlides(data))

    onProgress?.({
      current: Math.min(i + batch.length, total),
      total,
      phase: 'saving',
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  return inserted
}

export function useExtractSlides() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      projectId,
      storagePath,
      onProgress,
    }: {
      projectId: string
      storagePath: string
      onProgress?: (progress: ParseProgress) => void
    }): Promise<Slide[]> => {
      const buffer = await downloadPptx(storagePath)
      const parsed = await parsePptx(buffer, onProgress)
      const rows = toSlideRows(projectId, parsed)

      // slides 삭제 시 translations / verifications / spelling_results / expert_review_items CASCADE
      const { error: deleteError } = await supabase
        .from('slides')
        .delete()
        .eq('project_id', projectId)

      if (deleteError) throw deleteError

      const { error: reviewError } = await supabase
        .from('expert_reviews')
        .delete()
        .eq('project_id', projectId)

      if (reviewError) throw reviewError

      // 하위 데이터 삭제 후 상태를 추출 전으로 되돌려 빈 Step3가 done으로 남는 것을 방지
      const { error: statusError } = await supabase
        .from('projects')
        .update({ status: 'uploaded' })
        .eq('id', projectId)

      if (statusError) throw statusError

      if (rows.length === 0) return []

      return insertSlideRows(rows, onProgress)
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...slidesQueryKey, variables.projectId] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['projects', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: ['translations', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: ['verifications', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: ['spelling', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: ['expert_reviews', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: ['expert-reviews', variables.projectId] })
    },
  })
}

export function useUpsertSlides() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      projectId,
      slides,
    }: {
      projectId: string
      slides: SlideInsert[]
    }): Promise<Slide[]> => {
      const { error: deleteError } = await supabase
        .from('slides')
        .delete()
        .eq('project_id', projectId)

      if (deleteError) throw deleteError

      if (slides.length === 0) return []

      const { data, error } = await supabase.from('slides').insert(slides).select()

      if (error) throw error
      return normalizeSlides(data)
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...slidesQueryKey, variables.projectId] })
    },
  })
}

function prepareSlideUpdateForDb(updates: SlideUpdate): Record<string, unknown> {
  if (updates.screen_text === undefined) return updates
  return {
    ...updates,
    screen_text: serializeScreenTextForDb(updates.screen_text ?? null),
  }
}

export function useUpdateSlide() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      projectId: _projectId,
      updates,
    }: {
      id: string
      projectId: string
      updates: SlideUpdate
    }): Promise<Slide> => {
      const { data, error } = await supabase
        .from('slides')
        .update(prepareSlideUpdateForDb(updates))
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return normalizeSlide(data)
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...slidesQueryKey, variables.projectId] })
    },
  })
}

export function useBulkUpdateSlides() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      projectId: _projectId,
      slides,
    }: {
      projectId: string
      slides: Slide[]
    }): Promise<Slide[]> => {
      const results: Slide[] = []

      for (const slide of slides) {
        const { data, error } = await supabase
          .from('slides')
          .update({
            slide_type: slide.slide_type,
            screen_num: slide.screen_num,
            course_name: slide.course_name,
            chapter_name: slide.chapter_name,
            current_section: slide.current_section,
            screen_text: serializeScreenTextForDb(slide.screen_text),
            screen_desc: slide.screen_desc,
            image_nums: slide.image_nums,
            narration: serializeNarrationForDb(slide.narration),
          })
          .eq('id', slide.id)
          .select()
          .single()

        if (error) throw error
        results.push(normalizeSlide(data))
      }

      return results
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...slidesQueryKey, variables.projectId] })
    },
  })
}

export function useDeleteSlide() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      projectId: _projectId,
    }: {
      id: string
      projectId: string
    }): Promise<void> => {
      const { error } = await supabase.from('slides').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...slidesQueryKey, variables.projectId] })
    },
  })
}

export function useParsePptxFromStorage() {
  return useMutation({
    mutationFn: async (storagePath: string) => {
      const buffer = await downloadPptx(storagePath)
      return parsePptx(buffer)
    },
  })
}

export function useCompleteExtraction() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      projectId,
      slides,
    }: {
      projectId: string
      slides: Slide[]
    }): Promise<void> => {
      for (const slide of slides) {
        const { error } = await supabase
          .from('slides')
          .update({
            slide_type: slide.slide_type,
            screen_num: slide.screen_num,
            screen_text: serializeScreenTextForDb(slide.screen_text),
            narration: serializeNarrationForDb(slide.narration),
          })
          .eq('id', slide.id)

        if (error) throw error
      }

      const { error: statusError } = await supabase
        .from('projects')
        .update({ status: 'extracted' })
        .eq('id', projectId)

      if (statusError) throw statusError

      if (user) {
        await supabase.from('change_logs').insert({
          project_id: projectId,
          user_id: user.id,
          action: 'extraction_done',
          detail: `${slides.length}개 슬라이드 추출 완료`,
        })
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['projects', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: [...slidesQueryKey, variables.projectId] })
    },
  })
}
