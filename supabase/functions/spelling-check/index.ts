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
import { buildSpellingFields, type SlideRow } from '../_shared/slides.ts'

const BATCH_SIZE = 5

interface SpellingCheckRequest {
  project_id: string
  slide_ids: string[]
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
      const suggestion = fieldResult?.corrected_text?.trim() || expected.text

      rows.push({
        project_id: projectId,
        slide_id: slide.id,
        field: expected.field_key,
        original: expected.text,
        suggestion,
        applied: false,
      })
    }
  }

  return rows
}

const SYSTEM_PROMPT = `당신은 한국어 이러닝 콘텐츠 전문 교정자입니다.
스토리보드 PPTX에서 추출한 화면 텍스트와 나레이션의 맞춤법, 띄어쓰기, 문법, 표기 일관성을 검토합니다.

규칙:
- 교육 콘텐츠에 맞는 정확하고 자연스러운 한국어를 사용합니다.
- 고유명사, 약어, 화면번호 등 의도된 표기는 유지합니다.
- 수정이 필요 없으면 corrected_text는 original_text와 동일하게 둡니다.
- issues에는 구체적인 문제 유형과 설명을 한국어로 작성합니다.
- 반드시 요청된 JSON 형식만 출력합니다.`

function buildSpellingPrompt(slides: SlideRow[]): string {
  const payload = slides.map((slide) => ({
    slide_id: slide.id,
    slide_num: slide.slide_num,
    slide_type: slide.slide_type,
    screen_num: slide.screen_num,
    fields: buildSpellingFields(slide),
  }))

  return `다음 슬라이드의 screen_text(화면 텍스트)와 narration(나레이션)을 맞춤법·내용 관점에서 검토하세요.

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
          "corrected_text": "교정문",
          "issues": [
            { "type": "spelling|spacing|grammar|style", "message": "설명" }
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
    await updateProjectStatus(serviceClient, body.project_id, 'spelling')

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
      )

      rowsToInsert.push(...mergeSpellingRows(body.project_id, batch, response))
    }

    const { error: deleteError } = await serviceClient
      .from('spelling_results')
      .delete()
      .eq('project_id', body.project_id)
      .in('slide_id', body.slide_ids)

    if (deleteError) {
      throw new HttpError(500, `기존 맞춤법 결과 삭제 실패: ${deleteError.message}`)
    }

    if (rowsToInsert.length > 0) {
      const { error: insertError } = await serviceClient
        .from('spelling_results')
        .insert(rowsToInsert)

      if (insertError) {
        throw new HttpError(500, `맞춤법 결과 저장 실패: ${insertError.message}`)
      }
    }

    await updateProjectStatus(serviceClient, body.project_id, 'spelling_done')

    await serviceClient.from('change_logs').insert({
      project_id: body.project_id,
      user_id: user.id,
      action: 'spelling_applied',
      detail: `${rowsToInsert.length}건 맞춤법 검사 완료`,
    })

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
