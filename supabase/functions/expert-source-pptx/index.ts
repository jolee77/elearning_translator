import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleCors } from '../_shared/cors.ts'
import { HttpError, errorResponse, jsonResponse, parseJsonBody } from '../_shared/http.ts'

interface RequestBody {
  token?: string
}

const STORAGE_BUCKET = 'pptx-files'
const SIGNED_URL_TTL_SEC = 120

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'POST만 허용됩니다.')
    }

    const body = await parseJsonBody<RequestBody>(req)
    const token = body.token?.trim()
    if (!token) {
      throw new HttpError(400, '검증 토큰이 필요합니다.')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      throw new HttpError(500, '서버 설정이 올바르지 않습니다.')
    }

    const admin = createClient(supabaseUrl, serviceRoleKey)

    const { data: review, error: reviewError } = await admin
      .from('expert_reviews')
      .select('id, project_id')
      .eq('token', token)
      .maybeSingle()

    if (reviewError) {
      throw new HttpError(500, `검증 링크 조회 실패: ${reviewError.message}`)
    }
    if (!review) {
      throw new HttpError(404, '유효하지 않은 검증 링크입니다.')
    }

    const { data: project, error: projectError } = await admin
      .from('projects')
      .select('id, title, source_pptx_url, source_pptx_name')
      .eq('id', review.project_id)
      .maybeSingle()

    if (projectError) {
      throw new HttpError(500, `프로젝트 조회 실패: ${projectError.message}`)
    }
    if (!project?.source_pptx_url) {
      throw new HttpError(404, '원본 PPTX 파일이 없습니다.')
    }

    const { data: signed, error: signedError } = await admin.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(project.source_pptx_url, SIGNED_URL_TTL_SEC)

    if (signedError || !signed?.signedUrl) {
      throw new HttpError(
        500,
        `다운로드 링크 생성 실패: ${signedError?.message ?? '알 수 없는 오류'}`,
      )
    }

    const fileName =
      project.source_pptx_name?.trim() ||
      `${project.title || 'storyboard'}.pptx`

    return jsonResponse({
      signedUrl: signed.signedUrl,
      fileName,
      expiresIn: SIGNED_URL_TTL_SEC,
    })
  } catch (error) {
    return errorResponse(error)
  }
})
