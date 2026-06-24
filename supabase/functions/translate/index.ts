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
import { calcKoCpm, calcTargetWpm, getLangConfig } from '../_shared/lang.ts'
import { buildTranslationFieldKeys, type SlideRow } from '../_shared/slides.ts'

const BATCH_SIZE = 3

interface TranslateRequest {
  project_id: string
  slide_ids: string[]
  target_lang: string
  reset_results?: boolean
  finalize?: boolean
}

interface TranslationItem {
  field_key: string
  ko_text: string
  vi_text: string
}

interface TranslationSlideResult {
  slide_id: string
  translations: TranslationItem[]
}

interface TranslationBatchResponse {
  results: TranslationSlideResult[]
}

const SYSTEM_PROMPT = `당신은 한국어 이러닝 스토리보드를 외국어로 번역하는 전문 번역가입니다.

규칙:
- 교육 콘텐츠에 맞는 정확하고 자연스러운 번역을 제공합니다.
- 화면에 표시되는 짧은 UI 텍스트는 간결하게 번역합니다.
- 나레이션(tr_narration)은 구두 발화에 적합한 자연스러운 문장으로 번역합니다.
- 고유명사·기술 용어는 일관되게 번역합니다.
- 원문의 의미와 뉘앙스를 유지합니다.
- 반드시 요청된 JSON 형식만 출력합니다.`

function buildTranslatePrompt(slides: SlideRow[], targetLang: string): string {
  const lang = getLangConfig(targetLang)

  const payload = slides.map((slide) => ({
    slide_id: slide.id,
    slide_num: slide.slide_num,
    slide_type: slide.slide_type,
    screen_num: slide.screen_num,
    fields: buildTranslationFieldKeys(slide),
  }))

  return `다음 한국어 이러닝 슬라이드 텍스트를 ${lang.name}(${targetLang})로 번역하세요.

입력:
${JSON.stringify(payload, null, 2)}

다음 JSON 형식으로만 응답하세요:
{
  "results": [
    {
      "slide_id": "슬라이드 UUID",
      "translations": [
        {
          "field_key": "필드키",
          "ko_text": "한국어 원문",
          "vi_text": "번역문"
        }
      ]
    }
  ]
}

주의: vi_text 필드명은 그대로 사용하되, 실제 번역 언어는 ${lang.name}입니다.`
}

serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'POST 메서드만 지원합니다.' }, 405)
  }

  try {
    const { user, serviceClient } = await authenticateRequest(req)
    const body = await parseJsonBody<TranslateRequest>(req)

    if (!body.project_id) {
      throw new HttpError(400, 'project_id가 필요합니다.')
    }

    if (!Array.isArray(body.slide_ids) || body.slide_ids.length === 0) {
      throw new HttpError(400, 'slide_ids 배열이 필요합니다.')
    }

    if (!body.target_lang) {
      throw new HttpError(400, 'target_lang이 필요합니다.')
    }

    getLangConfig(body.target_lang)
    await verifyProjectAccess(serviceClient, user.id, body.project_id)

    const apiKey = await getClaudeApiKey(serviceClient)
    const shouldFinalize = body.finalize !== false

    if (body.reset_results || shouldFinalize) {
      await updateProjectStatus(serviceClient, body.project_id, 'translating')
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
    const rowsToInsert: Array<{
      project_id: string
      slide_id: string
      field: string
      source: string
      vi_text: string
      cpm: number
      vi_wpm: number
    }> = []

    for (const batch of chunk(slideRows, BATCH_SIZE)) {
      const response = await callClaudeJson<TranslationBatchResponse>(
        apiKey,
        SYSTEM_PROMPT,
        buildTranslatePrompt(batch, body.target_lang),
      )

      for (const slideResult of response.results ?? []) {
        const slide = batch.find((item) => item.id === slideResult.slide_id)
        if (!slide) continue

        for (const item of slideResult.translations ?? []) {
          rowsToInsert.push({
            project_id: body.project_id,
            slide_id: slide.id,
            field: item.field_key,
            source: item.ko_text,
            vi_text: item.vi_text,
            cpm: calcKoCpm(item.ko_text),
            vi_wpm: calcTargetWpm(item.vi_text),
          })
        }
      }
    }

    if (body.reset_results) {
      const { error: resetError } = await serviceClient
        .from('translations')
        .delete()
        .eq('project_id', body.project_id)

      if (resetError) {
        throw new HttpError(500, `기존 번역 결과 삭제 실패: ${resetError.message}`)
      }
    } else {
      const { error: deleteError } = await serviceClient
        .from('translations')
        .delete()
        .eq('project_id', body.project_id)
        .in('slide_id', body.slide_ids)

      if (deleteError) {
        throw new HttpError(500, `기존 번역 결과 삭제 실패: ${deleteError.message}`)
      }
    }

    if (rowsToInsert.length > 0) {
      const { error: insertError } = await serviceClient.from('translations').insert(rowsToInsert)

      if (insertError) {
        throw new HttpError(500, `번역 결과 저장 실패: ${insertError.message}`)
      }
    }

    if (shouldFinalize) {
      await updateProjectStatus(serviceClient, body.project_id, 'translated')

      await serviceClient.from('change_logs').insert({
        project_id: body.project_id,
        user_id: user.id,
        action: 'translation_done',
        detail: `${rowsToInsert.length}건 번역 완료 (${body.target_lang})`,
      })
    }

    return jsonResponse({
      success: true,
      project_id: body.project_id,
      target_lang: body.target_lang,
      processed_slides: slideRows.length,
      translation_count: rowsToInsert.length,
    })
  } catch (error) {
    return errorResponse(error)
  }
})
