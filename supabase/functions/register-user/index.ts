import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2'
import { authenticateRequest } from '../_shared/auth.ts'
import { handleCors } from '../_shared/cors.ts'
import { HttpError, errorResponse, jsonResponse, parseJsonBody } from '../_shared/http.ts'

interface RegisterRequest {
  email: string
  name: string
  password: string
  role: 'admin' | 'designer'
}

function isDuplicateEmailError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('already been registered') ||
    normalized.includes('already registered') ||
    normalized.includes('user already registered')
  )
}

async function findUserByEmail(
  serviceClient: SupabaseClient,
  email: string,
): Promise<User | null> {
  let page = 1

  while (true) {
    const { data, error } = await serviceClient.auth.admin.listUsers({ page, perPage: 100 })
    if (error) {
      throw new HttpError(500, `사용자 조회 실패: ${error.message}`)
    }

    const matched = data.users.find((candidate) => candidate.email?.toLowerCase() === email)
    if (matched) return matched

    if (data.users.length < 100) return null
    page++
  }
}

async function upsertProfile(
  serviceClient: SupabaseClient,
  userId: string,
  email: string,
  name: string,
  role: 'admin' | 'designer',
): Promise<void> {
  const { error: profileError } = await serviceClient.from('profiles').upsert(
    {
      id: userId,
      email,
      name,
      role,
    },
    { onConflict: 'id' },
  )

  if (profileError) {
    throw new HttpError(500, `프로필 생성 실패: ${profileError.message}`)
  }
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
    throw new HttpError(403, '관리자만 사용자를 등록할 수 있습니다.')
  }
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const { user, serviceClient } = await authenticateRequest(req)
    await verifyAdmin(serviceClient, user.id)

    const { email, name, password, role } = await parseJsonBody<RegisterRequest>(req)

    if (!email?.trim()) {
      throw new HttpError(400, '이메일을 입력해 주세요.')
    }

    if (!name?.trim()) {
      throw new HttpError(400, '이름을 입력해 주세요.')
    }

    if (!password || password.length < 8) {
      throw new HttpError(400, '비밀번호는 8자 이상이어야 합니다.')
    }

    const normalizedEmail = email.trim().toLowerCase()
    const trimmedName = name.trim()
    const userRole = role === 'admin' ? 'admin' : 'designer'

    const { data: createData, error: createError } =
      await serviceClient.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true,
        user_metadata: { name: trimmedName },
      })

    let targetUserId: string | null = createData.user?.id ?? null

    if (createError) {
      if (!isDuplicateEmailError(createError.message)) {
        throw new HttpError(400, createError.message)
      }

      const existingUser = await findUserByEmail(serviceClient, normalizedEmail)
      if (!existingUser) {
        throw new HttpError(400, createError.message)
      }

      targetUserId = existingUser.id

      const { error: updateError } = await serviceClient.auth.admin.updateUserById(targetUserId, {
        password,
        email_confirm: true,
        user_metadata: { name: trimmedName },
      })

      if (updateError) {
        throw new HttpError(400, `기존 계정 업데이트 실패: ${updateError.message}`)
      }
    }

    if (!targetUserId) {
      throw new HttpError(500, '사용자 ID를 확인할 수 없습니다.')
    }

    await upsertProfile(serviceClient, targetUserId, normalizedEmail, trimmedName, userRole)

    return jsonResponse({ success: true })
  } catch (error) {
    return errorResponse(error)
  }
})
