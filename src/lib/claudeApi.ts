import { supabase } from './supabase'

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

async function getAuthHeaders(): Promise<HeadersInit> {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.access_token) {
    throw new Error('로그인이 필요합니다.')
  }

  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  }
}

async function invokeFunction<T>(name: string, body: unknown): Promise<T> {
  const headers = await getAuthHeaders()
  const response = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error ?? `Edge Function 호출 실패 (${response.status})`)
  }

  return data as T
}

export interface SpellingCheckResponse {
  success: boolean
  project_id: string
  processed_slides: number
  result_count: number
}

export function spellingCheck(
  projectId: string,
  slideIds: string[],
  options?: { resetResults?: boolean; finalize?: boolean },
) {
  return invokeFunction<SpellingCheckResponse>('spelling-check', {
    project_id: projectId,
    slide_ids: slideIds,
    reset_results: options?.resetResults ?? false,
    finalize: options?.finalize ?? true,
  })
}

export function translateSlides(
  projectId: string,
  slideIds: string[],
  targetLang: string,
) {
  return invokeFunction('translate', {
    project_id: projectId,
    slide_ids: slideIds,
    target_lang: targetLang,
  })
}

export function verifyTranslations(projectId: string) {
  return invokeFunction('verify', { project_id: projectId })
}

export function extractGlossary(projectId: string) {
  return invokeFunction<{ terms: unknown[]; summary: string }>('extract-glossary', {
    project_id: projectId,
  })
}
