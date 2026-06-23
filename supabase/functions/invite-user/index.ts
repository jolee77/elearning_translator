import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { authenticateRequest } from '../_shared/auth.ts'
import { handleCors } from '../_shared/cors.ts'
import { HttpError, errorResponse, jsonResponse, parseJsonBody } from '../_shared/http.ts'

interface InviteRequest {
  email: string
  name: string
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
    throw new HttpError(403, '관리자만 사용자를 초대할 수 있습니다.')
  }
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const { user, serviceClient } = await authenticateRequest(req)
    await verifyAdmin(serviceClient, user.id)

    const { email, name } = await parseJsonBody<InviteRequest>(req)

    if (!email?.trim()) {
      throw new HttpError(400, '이메일을 입력해 주세요.')
    }

    if (!name?.trim()) {
      throw new HttpError(400, '이름을 입력해 주세요.')
    }

    const normalizedEmail = email.trim().toLowerCase()

    const { data: inviteData, error: inviteError } =
      await serviceClient.auth.admin.inviteUserByEmail(normalizedEmail, {
        data: { name: name.trim() },
      })

    if (inviteError) {
      throw new HttpError(400, inviteError.message)
    }

    if (inviteData.user) {
      const { error: profileError } = await serviceClient.from('profiles').upsert(
        {
          id: inviteData.user.id,
          email: normalizedEmail,
          name: name.trim(),
          role: 'designer',
        },
        { onConflict: 'id' },
      )

      if (profileError) {
        throw new HttpError(500, `프로필 생성 실패: ${profileError.message}`)
      }
    }

    return jsonResponse({ success: true })
  } catch (error) {
    return errorResponse(error)
  }
})
