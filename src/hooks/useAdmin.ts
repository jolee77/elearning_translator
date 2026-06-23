import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Profile, Project, Settings, UserRole } from '../types'
import { useAuth } from './useAuth'

const settingsQueryKey = ['admin', 'settings'] as const
const profilesQueryKey = ['admin', 'profiles'] as const
const allProjectsQueryKey = ['admin', 'projects'] as const

export function useSettings() {
  return useQuery({
    queryKey: settingsQueryKey,
    queryFn: async (): Promise<Settings | null> => {
      const { data, error } = await supabase
        .from('settings')
        .select('*')
        .limit(1)
        .maybeSingle()

      if (error) throw error
      return data
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

      const { data: existing, error: fetchError } = await supabase
        .from('settings')
        .select('*')
        .limit(1)
        .maybeSingle()

      if (fetchError) throw fetchError

      const payload: Record<string, unknown> = {
        default_target_lang: input.defaultTargetLang,
        updated_by: user.id,
      }

      if (input.claudeApiKey?.trim()) {
        payload.claude_api_key = input.claudeApiKey.trim()
      }

      if (existing) {
        const { data, error } = await supabase
          .from('settings')
          .update(payload)
          .eq('id', existing.id)
          .select()
          .single()

        if (error) throw error
        return data
      }

      const { data, error } = await supabase
        .from('settings')
        .insert({
          ...payload,
          claude_api_key: input.claudeApiKey?.trim() || null,
        })
        .select()
        .single()

      if (error) throw error
      return data
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

export function useInviteUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      email,
      name,
    }: {
      email: string
      name: string
    }): Promise<void> => {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) throw new Error('로그인이 필요합니다.')

      const response = await supabase.functions.invoke('invite-user', {
        body: { email: email.trim(), name: name.trim() },
      })

      if (response.error) {
        throw new Error(response.error.message)
      }

      const body = response.data as { error?: string } | null
      if (body?.error) {
        throw new Error(body.error)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profilesQueryKey })
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

      const userIds = [...new Set(projects.map((p) => p.user_id))]
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, name, email')
        .in('id', userIds)

      if (profilesError) throw profilesError

      const profileMap = new Map(profiles.map((p) => [p.id, p]))

      return projects.map((project) => ({
        ...project,
        creator: profileMap.get(project.user_id) ?? null,
      }))
    },
  })
}
