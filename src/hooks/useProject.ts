import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Project, ProjectStatus } from '../types'
import { useAuth } from './useAuth'

export const STORAGE_BUCKET = 'projects'

const projectsQueryKey = ['projects'] as const

export function getPptxStoragePath(userId: string, projectId: string): string {
  return `${userId}/${projectId}/source.pptx`
}

export function useProjects() {
  const { user } = useAuth()

  return useQuery({
    queryKey: [...projectsQueryKey, user?.id],
    queryFn: async (): Promise<Project[]> => {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('user_id', user!.id)
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
          user_id: user.id,
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
        .update({ ko_pptx_path: storagePath })
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
