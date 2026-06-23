import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import {
  authenticateRequest,
  getClaudeApiKey,
  verifyProjectAccess,
} from '../_shared/auth.ts'
import { callClaudeJson } from '../_shared/claude.ts'
import { handleCors } from '../_shared/cors.ts'
import { HttpError, errorResponse, jsonResponse, parseJsonBody } from '../_shared/http.ts'
import { getLangConfig } from '../_shared/lang.ts'

interface ExtractGlossaryRequest {
  project_id: string
}

interface TranslationRow {
  id: string
  slide_id: string
  field_key: string
  ko_text: string
  vi_text: string
}

interface GlossaryTerm {
  ko: string
  target: string
  category: string
  note: string | null
}

interface GlossaryResponse {
  project_id: string
  target_lang: string
  target_lang_name: string
  terms: GlossaryTerm[]
  summary: string
}

const SYSTEM_PROMPT = `당신은 이러닝 번역 프로젝트의 용어집(glossary) 추출 전문가입니다.
한국어 원문과 번역문 쌍에서 반복되는 전문 용어, 고유명사, 약어를 추출합니다.

규칙:
- 교육 콘텐츠에서 일관되게 번역해야 할 용어만 추출합니다.
- 일반 단어, 조사, 접속사는 제외합니다.
- category는 technical|proper_noun|abbreviation|general 중 하나입니다.
- note에는 번역 시 주의사항이 있으면 한국어로 작성, 없으면 null입니다.
- 반드시 요청된 JSON 형식만 출력합니다.`

function buildGlossaryPrompt(
  translations: TranslationRow[],
  targetLang: string,
  targetLangName: string,
): string {
  const pairs = translations.map((row) => ({
    field_key: row.field_key,
    ko_text: row.ko_text,
    target_text: row.vi_text,
  }))

  return `다음 번역 데이터에서 ${targetLangName}(${targetLang}) 용어집을 추출하세요.

입력:
${JSON.stringify(pairs, null, 2)}

다음 JSON 형식으로만 응답하세요:
{
  "terms": [
    {
      "ko": "한국어 용어",
      "target": "번역 용어",
      "category": "technical|proper_noun|abbreviation|general",
      "note": "주의사항 또는 null"
    }
  ],
  "summary": "용어집 요약 (한국어)"
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
    const body = await parseJsonBody<ExtractGlossaryRequest>(req)

    if (!body.project_id) {
      throw new HttpError(400, 'project_id가 필요합니다.')
    }

    await verifyProjectAccess(serviceClient, user.id, body.project_id)

    const { data: project, error: projectError } = await serviceClient
      .from('projects')
      .select('target_lang')
      .eq('id', body.project_id)
      .maybeSingle()

    if (projectError) {
      throw new HttpError(500, `프로젝트 조회 실패: ${projectError.message}`)
    }

    if (!project) {
      throw new HttpError(404, '프로젝트를 찾을 수 없습니다.')
    }

    const langConfig = getLangConfig(project.target_lang)

    const { data: translations, error: translationsError } = await serviceClient
      .from('translations')
      .select('id, slide_id, field_key, ko_text, vi_text')
      .eq('project_id', body.project_id)
      .not('ko_text', 'is', null)
      .not('vi_text', 'is', null)

    if (translationsError) {
      throw new HttpError(500, `번역 조회 실패: ${translationsError.message}`)
    }

    const translationRows = (translations ?? []) as TranslationRow[]

    if (translationRows.length === 0) {
      throw new HttpError(404, '용어 추출에 사용할 번역 데이터가 없습니다.')
    }

    const apiKey = await getClaudeApiKey(serviceClient)

    const response = await callClaudeJson<{
      terms: GlossaryTerm[]
      summary: string
    }>(
      apiKey,
      SYSTEM_PROMPT,
      buildGlossaryPrompt(translationRows, project.target_lang, langConfig.name),
    )

    const result: GlossaryResponse = {
      project_id: body.project_id,
      target_lang: project.target_lang,
      target_lang_name: langConfig.name,
      terms: response.terms ?? [],
      summary: response.summary ?? '',
    }

    return jsonResponse(result)
  } catch (error) {
    return errorResponse(error)
  }
})
