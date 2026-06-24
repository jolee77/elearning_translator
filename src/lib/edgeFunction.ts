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

export async function invokeEdgeFunction<T>(name: string, body: unknown): Promise<T> {
  const headers = await getAuthHeaders()
  const response = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

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
