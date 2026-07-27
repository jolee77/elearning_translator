import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import {
  authenticateRequest,
  getClaudeApiKey,
  updateProjectStatus,
  verifyProjectAccess,
} from '../_shared/auth.ts'
import { callClaudeJson, CLAUDE_SPELLING_MODEL } from '../_shared/claude.ts'
import { handleCors } from '../_shared/cors.ts'
import { HttpError, chunk, errorResponse, jsonResponse, parseJsonBody } from '../_shared/http.ts'
import { buildSpellingFields, type SlideRow } from '../_shared/slides.ts'
import { sanitizeSpellingField } from '../_shared/textNormalize.ts'

/** 슬라이드 N개당 Claude API 1회 */
const BATCH_SIZE = 10
const SPELLING_MAX_TOKENS = 8192

interface SpellingCheckRequest {
  project_id: string
  slide_ids: string[]
  reset_results?: boolean
  finalize?: boolean
}

interface SpellingIssue {
  type: string
  message: string
  offset?: number
  length?: number
}

interface SpellingFieldResult {
  field_key: string
  original_text: string
  corrected_text: string
  issues: SpellingIssue[]
}

interface SpellingSlideResult {
  slide_id: string
  fields: SpellingFieldResult[]
}

interface SpellingBatchResponse {
  results: SpellingSlideResult[]
}

type SpellingInsertRow = {
  project_id: string
  slide_id: string
  field: string
  original: string
  suggestion: string
  applied: boolean
  issues: SpellingIssue[]
}

function findFieldResult(
  fields: SpellingFieldResult[] | undefined,
  fieldKey: string,
): SpellingFieldResult | undefined {
  if (!fields?.length) return undefined

  const exact = fields.find((field) => field.field_key === fieldKey)
  if (exact) return exact

  if (fieldKey === 'narration') {
    return fields.find((field) => field.field_key === 'narration')
  }

  if (fieldKey.startsWith('screen_text_')) {
    return fields.find((field) => field.field_key === fieldKey)
  }

  if (fieldKey === 'screen_text') {
    return fields.find((field) => field.field_key === 'screen_text')
      ?? fields.find((field) => field.field_key.startsWith('screen_text_'))
  }

  return undefined
}

function mergeSpellingRows(
  projectId: string,
  batch: SlideRow[],
  response: SpellingBatchResponse,
): SpellingInsertRow[] {
  const rows: SpellingInsertRow[] = []

  for (const slide of batch) {
    const slideResult = response.results?.find((item) => item.slide_id === slide.id)
      ?? response.results?.find((item) => {
        const slideNum = (item as SpellingSlideResult & { slide_num?: number }).slide_num
        return slideNum != null && slideNum === slide.slide_num
      })

    const expectedFields = buildSpellingFields(slide)
    for (const expected of expectedFields) {
      const fieldResult = findFieldResult(slideResult?.fields, expected.field_key)
      const suggestionRaw = fieldResult?.corrected_text?.trim() || expected.text
      const rawIssues =
        fieldResult?.issues?.filter((issue) => issue.message?.trim()) ?? []
      const { suggestion, issues } = sanitizeSpellingField(
        expected.text,
        suggestionRaw,
        rawIssues,
      )

      rows.push({
        project_id: projectId,
        slide_id: slide.id,
        field: expected.field_key,
        original: expected.text,
        suggestion,
        applied: false,
        issues,
      })
    }
  }

  return rows
}

const SYSTEM_PROMPT = `당신은 한국어 이러닝 스토리보드의 맞춤법·띄어쓰기 교정자입니다.
역할은 명확한 오타·띄어쓰기·맞춤법 오류만 고치는 것이며, 문장·표현·내용을 다듬거나 바꾸지 않습니다.

최소 교정 원칙 (매우 중요):
- corrected_text는 원문(original_text)에서 오류 구간만 최소로 고칩니다.
- 예: "만들수" → "만들 수" 처럼 해당 오류만 수정. 문장 전체를 다른 표현으로 바꾸지 마세요.
- 문장 구조 변경, 어휘 교체, 표현 개선, 자연스러움·가독성 향상, 교수설계·교육적 재작성은 금지입니다.
- 능력단위 요소·수행준거·학습목표·개요·목록형 문구는 NCS/원문 표기를 그대로 둡니다. 오타·띄어쓰기만 고칩니다.
- 고유명사, 약어, 화면번호, 전문 용어의 의도된 표기는 유지합니다.
- 수정이 필요 없으면 corrected_text는 original_text와 문자 단위로 동일하게 둡니다.
- 확신이 없으면 고치지 마세요 (원문 유지).
- issues에는 실제 고친 오류만 한국어로 짧게 적습니다. 고치지 않은 항목에 style·표현 개선 제안을 넣지 마세요.
- 오자·탈자·철자 오류는 type=spelling, 띄어쓰기는 type=spacing, 명백한 조사/어미 오류만 type=grammar.
- type=style은 사용하지 마세요 (표현·문체 제안 금지).
- 반드시 요청된 JSON 형식만 출력합니다.

화면 텍스트(screen_text) 줄바꿈 규칙 (매우 중요):
- PPTX 화면 텍스트는 한 문장이 줄바꿈으로 나뉘어 추출되는 경우가 많습니다.
- 줄바꿈 직후에 띄어쓰기가 없어도 오류가 아닙니다. (예: "생산능력을\\n확인한다" — 정상)
- 줄바꿈 직전 행 끝의 공백은 레이아웃용이므로, 줄바꿈 뒤에 띄어쓰기를 추가하거나 이중 띄어쓰기로 바꾸지 마세요.
- 줄바꿈 자체를 제거해 한 줄로 합치지 마세요. 줄바꿈은 유지합니다.`

function buildSpellingPrompt(slides: SlideRow[]): string {
  const payload = slides.map((slide) => ({
    slide_id: slide.id,
    slide_num: slide.slide_num,
    slide_type: slide.slide_type,
    screen_num: slide.screen_num,
    fields: buildSpellingFields(slide),
  }))

  return `다음 슬라이드의 screen_text(화면 텍스트)와 narration(나레이션)을 맞춤법·띄어쓰기만 검토하세요.
문장·표현·내용을 바꾸지 말고, 명확한 오타·띄어쓰기만 최소 교정하세요.
화면 텍스트의 줄바꿈은 문장 나눔 표현이므로, 줄바꿈 전후 띄어쓰기를 임의로 넣거나 빼지 마세요.

입력:
${JSON.stringify(payload, null, 2)}

다음 JSON 형식으로만 응답하세요:
{
  "results": [
    {
      "slide_id": "슬라이드 UUID",
      "fields": [
        {
          "field_key": "필드키",
          "original_text": "원문",
          "corrected_text": "최소 교정문(없으면 원문과 동일)",
          "issues": [
            { "type": "spelling|spacing|grammar", "message": "설명" }
          ]
        }
      ]
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
    const body = await parseJsonBody<SpellingCheckRequest>(req)

    if (!body.project_id) {
      throw new HttpError(400, 'project_id가 필요합니다.')
    }

    if (!Array.isArray(body.slide_ids) || body.slide_ids.length === 0) {
      throw new HttpError(400, 'slide_ids 배열이 필요합니다.')
    }

    await verifyProjectAccess(serviceClient, user.id, body.project_id)

    const apiKey = await getClaudeApiKey(serviceClient)
    const shouldFinalize = body.finalize !== false

    if (body.reset_results || shouldFinalize) {
      await updateProjectStatus(serviceClient, body.project_id, 'spelling')
    }

    const { data: slides, error: slidesError } = await serviceClient
      .from('slides')
      .select('id, project_id, slide_num, slide_type, screen_num, screen_text, narration')
      .eq('project_id', body.project_id)
      .in('id', body.slide_ids)
      .order('slide_num', { ascending: true })

    if (slidesError) {
      throw new HttpError(500, `슬라이드 조회 실패: ${slidesError.message}`)
    }

    if (!slides?.length) {
      throw new HttpError(404, '처리할 슬라이드가 없습니다.')
    }

    const slideRows = slides as SlideRow[]
    const rowsToInsert: SpellingInsertRow[] = []
    const totalFieldCount = slideRows.reduce(
      (count, slide) => count + buildSpellingFields(slide).length,
      0,
    )

    if (totalFieldCount === 0) {
      throw new HttpError(
        400,
        '검사할 텍스트가 없습니다. 추출 확인 단계에서 화면 텍스트 또는 나레이션이 저장되었는지 확인해 주세요.',
      )
    }

    for (const batch of chunk(slideRows, BATCH_SIZE)) {
      const response = await callClaudeJson<SpellingBatchResponse>(
        apiKey,
        SYSTEM_PROMPT,
        buildSpellingPrompt(batch),
        SPELLING_MAX_TOKENS,
        CLAUDE_SPELLING_MODEL,
      )

      rowsToInsert.push(...mergeSpellingRows(body.project_id, batch, response))
    }

    if (body.reset_results) {
      const { error: resetError } = await serviceClient
        .from('spelling_results')
        .delete()
        .eq('project_id', body.project_id)

      if (resetError) {
        throw new HttpError(500, `기존 맞춤법 결과 삭제 실패: ${resetError.message}`)
      }
    } else {
      const { error: deleteError } = await serviceClient
        .from('spelling_results')
        .delete()
        .eq('project_id', body.project_id)
        .in('slide_id', body.slide_ids)

      if (deleteError) {
        throw new HttpError(500, `기존 맞춤법 결과 삭제 실패: ${deleteError.message}`)
      }
    }

    if (rowsToInsert.length > 0) {
      const { error: insertError } = await serviceClient
        .from('spelling_results')
        .insert(rowsToInsert)

      if (insertError) {
        throw new HttpError(500, `맞춤법 결과 저장 실패: ${insertError.message}`)
      }
    }

    if (shouldFinalize) {
      // AI 검사만 완료 — spelling_done은 사용자가 검토 완료할 때 클라이언트에서 설정
      await updateProjectStatus(serviceClient, body.project_id, 'spelling')

      await serviceClient.from('change_logs').insert({
        project_id: body.project_id,
        user_id: user.id,
        action: 'spelling_applied',
        detail: `${rowsToInsert.length}건 맞춤법 AI 검사 완료 (검토 대기)`,
      })
    }

    return jsonResponse({
      success: true,
      project_id: body.project_id,
      processed_slides: slideRows.length,
      result_count: rowsToInsert.length,
    })
  } catch (error) {
    return errorResponse(error)
  }
})
