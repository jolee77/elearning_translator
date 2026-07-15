import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { authenticateRequest } from '../_shared/auth.ts'
import { handleCors } from '../_shared/cors.ts'
import { HttpError, errorResponse, jsonResponse, parseJsonBody } from '../_shared/http.ts'

interface UpdateUserRequest {
  user_id: string
  name?: string
  email?: string
  password?: string
  role?: 'admin' | 'designer'
}

async function verifyAdmin(serviceClient: SupabaseClient, userId: string): Promise<void> {
  const { data: profile, error } = await serviceClient
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    throw new HttpError(500, `프로필 조회 실패: ${error.message}`)
  }

  if (profile?.role !== 'admin') {
    throw new HttpError(403, '관리자만 사용자 정보를 수정할 수 있습니다.')
  }
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const { user, serviceClient } = await authenticateRequest(req)
    await verifyAdmin(serviceClient, user.id)

    const body = await parseJsonBody<UpdateUserRequest>(req)
    const userId = body.user_id?.trim()

    if (!userId) {
      throw new HttpError(400, '사용자 ID가 필요합니다.')
    }

    const { data: existing, error: existingError } = await serviceClient
      .from('profiles')
      .select('id, email, name, role')
      .eq('id', userId)
      .maybeSingle()

    if (existingError) {
      throw new HttpError(500, `사용자 조회 실패: ${existingError.message}`)
    }

    if (!existing) {
      throw new HttpError(404, '사용자를 찾을 수 없습니다.')
    }

    if (userId === user.id && body.role && body.role !== 'admin') {
      throw new HttpError(400, '자신의 관리자 역할은 해제할 수 없습니다.')
    }

    const nextName = body.name !== undefined ? body.name.trim() : existing.name
    const nextEmail =
      body.email !== undefined ? body.email.trim().toLowerCase() : existing.email
    const nextRole = body.role === 'admin' || body.role === 'designer' ? body.role : existing.role

    if (!nextName) {
      throw new HttpError(400, '이름을 입력해 주세요.')
    }

    if (!nextEmail) {
      throw new HttpError(400, '이메일을 입력해 주세요.')
    }

    if (body.password !== undefined && body.password.length > 0 && body.password.length < 8) {
      throw new HttpError(400, '비밀번호는 8자 이상이어야 합니다.')
    }

    const authUpdate: {
      email?: string
      password?: string
      email_confirm?: boolean
      user_metadata?: { name: string }
    } = {
      user_metadata: { name: nextName },
    }

    if (nextEmail !== existing.email) {
      authUpdate.email = nextEmail
      authUpdate.email_confirm = true
    }

    if (body.password && body.password.length >= 8) {
      authUpdate.password = body.password
    }

    const { error: authError } = await serviceClient.auth.admin.updateUserById(userId, authUpdate)
    if (authError) {
      throw new HttpError(400, `계정 업데이트 실패: ${authError.message}`)
    }

    const { data: updated, error: profileError } = await serviceClient
      .from('profiles')
      .update({
        name: nextName,
        email: nextEmail,
        role: nextRole,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select()
      .single()

    if (profileError) {
      throw new HttpError(500, `프로필 업데이트 실패: ${profileError.message}`)
    }

    return jsonResponse({ success: true, profile: updated })
  } catch (error) {
    return errorResponse(error)
  }
})
