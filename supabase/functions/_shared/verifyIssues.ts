/** 역번역 issues에 UUID·필드키가 섞이지 않도록 사람 읽기용으로 정리 */

export function fieldTypeLabel(field: string): string {
  if (field === 'narration' || field === 'tr_narration') return '나레이션'
  return '화면텍스트'
}

export function quoteSource(source: string, max = 36): string {
  const compact = source.replace(/\s+/g, ' ').trim()
  if (!compact) return '(내용 없음)'
  if (compact.length <= max) return compact
  return `${compact.slice(0, Math.max(1, max - 1))}…`
}

export function buildVerifyItemLabel(field: string, source: string): string {
  return `${fieldTypeLabel(field)} 「${quoteSource(source)}」`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

type VerifyIssueItem = {
  id: string
  field: string
  source: string
}

/**
 * issues 문장 안의 translation UUID·field_key·도형 ID를
 * 「화면텍스트 『원문…』」 형태로 치환한다.
 */
export function sanitizeVerifyIssues(
  issues: string | null | undefined,
  items: VerifyIssueItem[],
): string | null {
  if (issues == null) return null
  let text = String(issues).trim()
  if (!text) return null
  if (!items.length) return text

  // 1) translation.id 우선 (다른 항목 참조가 보통 여기)
  const byIdLen = [...items].sort((a, b) => b.id.length - a.id.length)
  for (const item of byIdLen) {
    if (!item.id) continue
    const label = buildVerifyItemLabel(item.field, item.source)
    text = text.replace(new RegExp(escapeRegExp(item.id), 'gi'), label)
    const prefix = item.id.slice(0, 8)
    if (prefix.length >= 8) {
      text = text.replace(
        new RegExp(`${escapeRegExp(prefix)}(?:-[0-9a-f]{4}){0,3}(?:-[0-9a-f]{0,12})?\\s*항목`, 'gi'),
        label,
      )
      text = text.replace(
        new RegExp(`${escapeRegExp(prefix)}(?:-[0-9a-f]{4}){0,3}(?:-[0-9a-f]{0,12})?`, 'gi'),
        label,
      )
    }
  }

  // 2) field_key·도형 ID
  const byFieldLen = [...items].sort((a, b) => b.field.length - a.field.length)
  for (const item of byFieldLen) {
    const label = buildVerifyItemLabel(item.field, item.source)
    if (item.field && item.field.length > 2) {
      text = text.replace(new RegExp(escapeRegExp(item.field), 'gi'), fieldTypeLabel(item.field))
    }
    if (item.field.startsWith('screen_text_')) {
      const boxId = item.field.slice('screen_text_'.length)
      if (boxId.length >= 8) {
        text = text.replace(
          new RegExp(`${escapeRegExp(boxId.slice(0, 8))}(?:-[0-9a-f]{4}){0,3}(?:-[0-9a-f]{0,12})?\\s*항목`, 'gi'),
          label,
        )
        text = text.replace(new RegExp(escapeRegExp(boxId), 'gi'), label)
        text = text.replace(new RegExp(escapeRegExp(boxId.slice(0, 8)), 'gi'), label)
      }
    }
  }

  // 매칭되지 않은 잔여 UUID / 짧은 hex + '항목'
  text = text.replace(
    /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi,
    '다른 항목',
  )
  text = text.replace(/\b[0-9a-f]{8}\b\s*항목/gi, '다른 항목')

  return text.replace(/\s{2,}/g, ' ').trim()
}
