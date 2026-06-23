import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2'
import { HttpError } from './http.ts'

export function getEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new HttpError(500, `환경 변수 ${name}가 설정되지 않았습니다.`)
  return value
}

export function createUserClient(authHeader: string): SupabaseClient {
  return createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authHeader } },
  })
}

export function createServiceClient(): SupabaseClient {
  return createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'))
}

export async function authenticateRequest(req: Request): Promise<{
  user: User
  authHeader: string
  userClient: SupabaseClient
  serviceClient: SupabaseClient
}> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    throw new HttpError(401, 'Authorization 헤더가 필요합니다.')
  }

  const userClient = createUserClient(authHeader)
  const {
    data: { user },
    error,
  } = await userClient.auth.getUser()

  if (error || !user) {
    throw new HttpError(401, '인증에 실패했습니다.')
  }

  return {
    user,
    authHeader,
    userClient,
    serviceClient: createServiceClient(),
  }
}

export async function getClaudeApiKey(serviceClient: SupabaseClient): Promise<string> {
  const { data, error } = await serviceClient
    .from('settings')
    .select('value')
    .eq('key', 'claude_api_key')
    .maybeSingle()

  if (error) {
    throw new HttpError(500, `API 키 조회 실패: ${error.message}`)
  }

  if (!data?.value) {
    throw new HttpError(400, 'Claude API 키가 설정되지 않았습니다. 관리자 설정에서 등록해 주세요.')
  }

  return data.value
}

export async function verifyProjectAccess(
  serviceClient: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<void> {
  const { data: project, error: projectError } = await serviceClient
    .from('projects')
    .select('created_by')
    .eq('id', projectId)
    .maybeSingle()

  if (projectError) {
    throw new HttpError(500, `프로젝트 조회 실패: ${projectError.message}`)
  }

  if (!project) {
    throw new HttpError(404, '프로젝트를 찾을 수 없습니다.')
  }

  if (project.created_by === userId) return

  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()

  if (profileError) {
    throw new HttpError(500, `프로필 조회 실패: ${profileError.message}`)
  }

  if (profile?.role !== 'admin') {
    throw new HttpError(403, '이 프로젝트에 접근할 권한이 없습니다.')
  }
}

export async function updateProjectStatus(
  serviceClient: SupabaseClient,
  projectId: string,
  status: string,
): Promise<void> {
  const { error } = await serviceClient
    .from('projects')
    .update({ status })
    .eq('id', projectId)

  if (error) {
    throw new HttpError(500, `프로젝트 상태 업데이트 실패: ${error.message}`)
  }
}
