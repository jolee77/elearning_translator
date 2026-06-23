import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import {
  authenticateRequest,
  getClaudeApiKey,
  updateProjectStatus,
  verifyProjectAccess,
} from '../_shared/auth.ts'
import { callClaudeJson } from '../_shared/claude.ts'
import { handleCors } from '../_shared/cors.ts'
import { HttpError, chunk, errorResponse, jsonResponse, parseJsonBody } from '../_shared/http.ts'
import { NARRATION_FIELD_KEY } from '../_shared/slides.ts'

const BATCH_SIZE = 4

interface VerifyRequest {
  project_id: string
}

interface TranslationRow {
  id: string
  project_id: string
  slide_id: string
  field_key: string
  ko_text: string
  vi_text: string
}

interface VerifyItemResult {
  translation_id: string
  back_translation: string
  similarity_score: number
  issues: string | null
}

interface VerifyBatchResponse {
  results: VerifyItemResult[]
}

const SYSTEM_PROMPT = `당신은 번역 품질 검증 전문가입니다.
외국어 번역문을 한국어로 역번역(back-translation)하고, 원문과 비교하여 품질을 평가합니다.

규칙:
- 역번역은 자연스러운 한국어로 작성합니다.
- similarity_score는 0~100 정수 (100이 완벽 일치).
- 의미 누락, 오역, 어색한 표현이 있으면 issues에 한국어로 설명합니다.
- 문제가 없으면 issues는 null로 둡니다.
- 반드시 요청된 JSON 형식만 출력합니다.`

function buildVerifyPrompt(items: TranslationRow[]): string {
  const payload = items.map((item) => ({
    translation_id: item.id,
    field_key: item.field_key,
    ko_text: item.ko_text,
    translated_text: item.vi_text,
  }))

  return `다음 나레이션 번역(tr_narration)에 대해 역번역 검증을 수행하세요.

입력:
${JSON.stringify(payload, null, 2)}

각 항목에 대해 translated_text를 한국어로 역번역하고 ko_text와 비교하세요.

다음 JSON 형식으로만 응답하세요:
{
  "results": [
    {
      "translation_id": "번역 UUID",
      "back_translation": "역번역 한국어",
      "similarity_score": 95,
      "issues": "문제 설명 또는 null"
    }
  ]
}`
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'POST 메서드만 지원합니다.' }, 405)
  }

  try {
    const { user, serviceClient } = await authenticateRequest(req)
    const body = await parseJsonBody<VerifyRequest>(req)

    if (!body.project_id) {
      throw new HttpError(400, 'project_id가 필요합니다.')
    }

    await verifyProjectAccess(serviceClient, user.id, body.project_id)

    const apiKey = await getClaudeApiKey(serviceClient)
    await updateProjectStatus(serviceClient, body.project_id, 'verifying')

    const { data: translations, error: translationsError } = await serviceClient
      .from('translations')
      .select('id, project_id, slide_id, field_key, ko_text, vi_text')
      .eq('project_id', body.project_id)
      .eq('field_key', NARRATION_FIELD_KEY)
      .not('vi_text', 'is', null)

    if (translationsError) {
      throw new HttpError(500, `번역 조회 실패: ${translationsError.message}`)
    }

    const translationRows = (translations ?? []) as TranslationRow[]

    if (translationRows.length === 0) {
      throw new HttpError(404, '검증할 나레이션 번역(tr_narration)이 없습니다.')
    }

    const rowsToInsert: Array<{
      project_id: string
      slide_id: string
      translation_id: string
      back_translation: string
      similarity_score: number | null
      issues: string | null
      apply_status: string
    }> = []

    for (const batch of chunk(translationRows, BATCH_SIZE)) {
      const response = await callClaudeJson<VerifyBatchResponse>(
        apiKey,
        SYSTEM_PROMPT,
        buildVerifyPrompt(batch),
      )

      for (const item of response.results ?? []) {
        const translation = batch.find((row) => row.id === item.translation_id)
        if (!translation) continue

        rowsToInsert.push({
          project_id: body.project_id,
          slide_id: translation.slide_id,
          translation_id: translation.id,
          back_translation: item.back_translation,
          similarity_score: item.similarity_score ?? null,
          issues: item.issues,
          apply_status: 'pending',
        })
      }
    }

    const translationIds = translationRows.map((row) => row.id)

    const { error: deleteError } = await serviceClient
      .from('verifications')
      .delete()
      .eq('project_id', body.project_id)
      .in('translation_id', translationIds)

    if (deleteError) {
      throw new HttpError(500, `기존 검증 결과 삭제 실패: ${deleteError.message}`)
    }

    if (rowsToInsert.length > 0) {
      const { error: insertError } = await serviceClient
        .from('verifications')
        .insert(rowsToInsert)

      if (insertError) {
        throw new HttpError(500, `검증 결과 저장 실패: ${insertError.message}`)
      }
    }

    await updateProjectStatus(serviceClient, body.project_id, 'verified')

    await serviceClient.from('change_logs').insert({
      project_id: body.project_id,
      user_id: user.id,
      action: 'verification_applied',
      detail: `${rowsToInsert.length}건 역번역 검증 완료`,
    })

    return jsonResponse({
      success: true,
      project_id: body.project_id,
      verified_count: rowsToInsert.length,
    })
  } catch (error) {
    return errorResponse(error)
  }
})
