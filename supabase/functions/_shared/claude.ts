import { HttpError, extractJsonFromText } from './http.ts'

export const CLAUDE_MODEL = 'claude-sonnet-4-6'
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'

interface ClaudeResponse {
  content?: Array<{ type: string; text?: string }>
}

export async function callClaude(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 8192,
): Promise<string> {
  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new HttpError(response.status === 429 ? 429 : 502, `Claude API 오류: ${body}`)
  }

  const data = (await response.json()) as ClaudeResponse
  const text = data.content?.find((block) => block.type === 'text')?.text

  if (!text) {
    throw new HttpError(502, 'Claude API 응답이 비어 있습니다.')
  }

  return text
}

export async function callClaudeJson<T>(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 8192,
): Promise<T> {
  const text = await callClaude(apiKey, systemPrompt, userPrompt, maxTokens)
  return extractJsonFromText(text) as T
}
