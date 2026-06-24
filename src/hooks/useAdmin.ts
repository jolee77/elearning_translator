import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invokeEdgeFunction } from '../lib/edgeFunction'
import { supabase } from '../lib/supabase'
import type { Profile, Project, Settings, UserRole } from '../types'
import { useAuth } from './useAuth'

const settingsQueryKey = ['admin', 'settings'] as const
const profilesQueryKey = ['admin', 'profiles'] as const
const allProjectsQueryKey = ['admin', 'projects'] as const

function settingsFromRows(rows: { key: string; value: string | null }[]): Settings {
  const map = new Map(rows.map((row) => [row.key, row.value]))
  return {
    claude_api_key: map.get('claude_api_key') ?? null,
    default_target_lang: map.get('default_target_lang') ?? 'vi',
  }
}

export function useSettings() {
  return useQuery({
    queryKey: settingsQueryKey,
    queryFn: async (): Promise<Settings> => {
      const { data, error } = await supabase
        .from('settings')
        .select('key, value')

      if (error) throw error
      return settingsFromRows(data ?? [])
    },
  })
}

export interface UpdateSettingsInput {
  claudeApiKey?: string
  defaultTargetLang: string
}

export function useUpdateSettings() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpdateSettingsInput): Promise<Settings> => {
      if (!user) throw new Error('로그인이 필요합니다.')

      const rows: { key: string; value: string }[] = [
        { key: 'default_target_lang', value: input.defaultTargetLang },
      ]

      if (input.claudeApiKey?.trim()) {
        rows.push({ key: 'claude_api_key', value: input.claudeApiKey.trim() })
      }

      const { error } = await supabase
        .from('settings')
        .upsert(rows, { onConflict: 'key' })

      if (error) throw error

      const { data, error: fetchError } = await supabase
        .from('settings')
        .select('key, value')
        .in('key', ['claude_api_key', 'default_target_lang'])

      if (fetchError) throw fetchError
      return settingsFromRows(data ?? [])
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueryKey })
    },
  })
}

export function useProfiles() {
  return useQuery({
    queryKey: profilesQueryKey,
    queryFn: async (): Promise<Profile[]> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      return data
    },
  })
}

export function useUpdateProfileRole() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      role,
    }: {
      id: string
      role: UserRole
    }): Promise<Profile> => {
      const { data, error } = await supabase
        .from('profiles')
        .update({ role })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profilesQueryKey })
    },
  })
}

export function useRegisterUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      email,
      name,
      password,
      role,
    }: {
      email: string
      name: string
      password: string
      role: UserRole
    }): Promise<void> => {
      await invokeEdgeFunction<{ success: boolean }>('register-user', {
        email: email.trim(),
        name: name.trim(),
        password,
        role,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profilesQueryKey })
    },
  })
}

/** @deprecated register-user 사용 */
export function useInviteUser() {
  return useRegisterUser()
}

export function useDeleteProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (projectId: string): Promise<void> => {
      const { error } = await supabase.rpc('admin_delete_project', {
        p_project_id: projectId,
      })

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: allProjectsQueryKey })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export interface AdminProject extends Project {
  creator: Pick<Profile, 'id' | 'name' | 'email'> | null
}

export function useAllProjects() {
  return useQuery({
    queryKey: allProjectsQueryKey,
    queryFn: async (): Promise<AdminProject[]> => {
      const { data: projects, error: projectsError } = await supabase
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false })

      if (projectsError) throw projectsError
      if (!projects.length) return []

      const userIds = [...new Set(projects.map((p) => p.created_by))]
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, name, email')
        .in('id', userIds)

      if (profilesError) throw profilesError

      const profileMap = new Map(profiles.map((p) => [p.id, p]))

      return projects.map((project) => ({
        ...project,
        creator: profileMap.get(project.created_by) ?? null,
      }))
    },
  })
}
