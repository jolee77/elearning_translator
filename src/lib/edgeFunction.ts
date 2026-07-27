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

async function parseEdgeResponse<T>(response: Response): Promise<T> {
  let data: unknown
  try {
    data = await response.json()
  } catch {
    if (!response.ok) {
      throw new Error(`Edge Function 호출 실패 (${response.status})`)
    }
    throw new Error('응답을 파싱할 수 없습니다.')
  }

  if (!response.ok) {
    const payload = data as { error?: string; message?: string }
    throw new Error(payload.error ?? payload.message ?? `Edge Function 호출 실패 (${response.status})`)
  }

  return data as T
}

export async function invokeEdgeFunction<T>(name: string, body: unknown): Promise<T> {
  const headers = await getAuthHeaders()
  const response = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  return parseEdgeResponse<T>(response)
}

/** 로그인 없이(anon key) Edge Function 호출 — 전문가 검증 링크용 */
export async function invokeAnonEdgeFunction<T>(name: string, body: unknown): Promise<T> {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!anonKey) {
    throw new Error('Supabase 설정이 없습니다.')
  }

  const response = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  return parseEdgeResponse<T>(response)
}

export interface ExpertSourcePptxResult {
  signedUrl: string
  fileName: string
  expiresIn: number
}

export async function fetchExpertSourcePptx(token: string): Promise<ExpertSourcePptxResult> {
  return invokeAnonEdgeFunction<ExpertSourcePptxResult>('expert-source-pptx', { token })
}
