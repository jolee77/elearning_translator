import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Project, ProjectStatus } from '../types'
import { useAuth } from './useAuth'

export const STORAGE_BUCKET = 'pptx-files'

const projectsQueryKey = ['projects'] as const

export function getPptxStoragePath(userId: string, projectId: string): string {
  return `${userId}/${projectId}/source.pptx`
}

async function clearProjectWorkflowData(projectId: string): Promise<void> {
  const { data: reviews, error: reviewsQueryError } = await supabase
    .from('expert_reviews')
    .select('id')
    .eq('project_id', projectId)

  if (reviewsQueryError) throw reviewsQueryError

  const reviewIds = reviews?.map((r) => r.id) ?? []
  if (reviewIds.length > 0) {
    const { error: itemsError } = await supabase
      .from('expert_review_items')
      .delete()
      .in('expert_review_id', reviewIds)
    if (itemsError) throw itemsError
  }

  const tables = [
    'expert_reviews',
    'verifications',
    'translations',
    'spelling_results',
    'slides',
  ] as const

  for (const table of tables) {
    const { error } = await supabase.from(table).delete().eq('project_id', projectId)
    if (error) throw error
  }
}

export function useProjects() {
  const { user } = useAuth()

  return useQuery({
    queryKey: [...projectsQueryKey, user?.id],
    queryFn: async (): Promise<Project[]> => {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('created_by', user!.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data
    },
    enabled: !!user,
  })
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: [...projectsQueryKey, id],
    queryFn: async (): Promise<Project> => {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id!)
        .single()

      if (error) throw error
      return data
    },
    enabled: !!id,
    refetchInterval: (query) => {
      const project = query.state.data
      return project?.status === 'expert_review' ? 30_000 : false
    },
  })
}

export interface CreateProjectInput {
  courseName: string
  episodeName: string
  targetLang: string
  pptxFile: File
}

export function useCreateProject() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateProjectInput): Promise<Project> => {
      if (!user) throw new Error('로그인이 필요합니다.')

      const title = `${input.courseName.trim()} - ${input.episodeName.trim()}`

      const { data: project, error: createError } = await supabase
        .from('projects')
        .insert({
          created_by: user.id,
          title,
          status: 'uploaded',
          target_lang: input.targetLang,
        })
        .select()
        .single()

      if (createError) throw createError

      const storagePath = getPptxStoragePath(user.id, project.id)

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, input.pptxFile, {
          contentType:
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          upsert: false,
        })

      if (uploadError) {
        await supabase.from('projects').delete().eq('id', project.id)
        throw uploadError
      }

      const { data: updated, error: updateError } = await supabase
        .from('projects')
        .update({
          source_pptx_url: storagePath,
          source_pptx_name: input.pptxFile.name,
        })
        .eq('id', project.id)
        .select()
        .single()

      if (updateError) throw updateError

      await supabase.from('change_logs').insert([
        {
          project_id: project.id,
          user_id: user.id,
          action: 'project_created',
          detail: title,
        },
        {
          project_id: project.id,
          user_id: user.id,
          action: 'pptx_uploaded',
          detail: storagePath,
        },
      ])

      return updated
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectsQueryKey })
    },
  })
}

export interface ReplaceProjectPptxInput {
  projectId: string
  pptxFile: File
}

export function useReplaceProjectPptx() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: ReplaceProjectPptxInput): Promise<Project> => {
      if (!user) throw new Error('로그인이 필요합니다.')

      const storagePath = getPptxStoragePath(user.id, input.projectId)

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, input.pptxFile, {
          contentType:
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          upsert: true,
        })

      if (uploadError) throw uploadError

      await clearProjectWorkflowData(input.projectId)

      const { data: updated, error: updateError } = await supabase
        .from('projects')
        .update({
          source_pptx_url: storagePath,
          source_pptx_name: input.pptxFile.name,
          status: 'uploaded' satisfies ProjectStatus,
          vn_pptx: null,
        })
        .eq('id', input.projectId)
        .select()
        .single()

      if (updateError) throw updateError

      await supabase.from('change_logs').insert({
        project_id: input.projectId,
        user_id: user.id,
        action: 'pptx_uploaded',
        detail: `파일 변경: ${input.pptxFile.name}`,
      })

      return updated
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['slides', data.id], [])
      queryClient.invalidateQueries({ queryKey: projectsQueryKey })
      queryClient.invalidateQueries({ queryKey: [...projectsQueryKey, data.id] })
      queryClient.invalidateQueries({ queryKey: ['slides', data.id] })
      queryClient.invalidateQueries({ queryKey: ['translations', data.id] })
      queryClient.invalidateQueries({ queryKey: ['verifications', data.id] })
      queryClient.invalidateQueries({ queryKey: ['spelling', data.id] })
      queryClient.invalidateQueries({ queryKey: ['expert-reviews', data.id] })
    },
  })
}

export function useUpdateProjectStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string
      status: ProjectStatus
    }): Promise<Project> => {
      const { data, error } = await supabase
        .from('projects')
        .update({ status })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: projectsQueryKey })
      queryClient.invalidateQueries({ queryKey: [...projectsQueryKey, data.id] })
    },
  })
}
