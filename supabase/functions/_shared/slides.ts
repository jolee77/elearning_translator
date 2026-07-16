export interface SlideTextBox {
  id: string
  text: string
  x: number
  y: number
  w: number
  h: number
  font_size?: number
}

export interface SlideRow {
  id: string
  project_id: string
  slide_num: number
  slide_type: string
  screen_num: string | null
  screen_text: SlideTextBox[] | string | null
  narration: SlideTextBox[] | string | null
  exclude_from_translation?: boolean | null
  excluded_fields?: string[] | null
}

export function normalizeNarration(
  raw: SlideTextBox[] | string | null | undefined,
): SlideTextBox[] | null {
  if (raw == null) return null
  if (Array.isArray(raw)) return raw.length > 0 ? raw : null

  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed || trimmed === 'null') return null
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        if (Array.isArray(parsed)) return parsed.length > 0 ? (parsed as SlideTextBox[]) : null
      } catch {
        // plain text fallback
      }
    }
    return [{ id: '0', text: trimmed, x: 0, y: 0, w: 0, h: 0 }]
  }

  return null
}

export function formatNarration(narration: SlideTextBox[] | string | null): string {
  const normalized = normalizeNarration(narration)
  if (!normalized?.length) return ''
  return normalized
    .map((box) => String(box.text ?? '').trim())
    .filter(Boolean)
    .join('\n')
}

export function normalizeScreenText(
  raw: SlideTextBox[] | string | null | undefined,
): SlideTextBox[] | null {
  if (raw == null) return null
  if (Array.isArray(raw)) return raw.length > 0 ? raw : null

  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed || trimmed === 'null') return null
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        if (Array.isArray(parsed)) return parsed.length > 0 ? (parsed as SlideTextBox[]) : null
      } catch {
        // plain text fallback
      }
    }
    return [{ id: '0', text: trimmed, x: 0, y: 0, w: 0, h: 0 }]
  }

  return null
}

export function formatScreenText(screenText: SlideTextBox[] | string | null): string {
  const normalized = normalizeScreenText(screenText)
  if (!normalized?.length) return ''
  return normalized
    .map((box, index) => boxText(box, index))
    .filter(Boolean)
    .join('\n')
}

function boxText(box: SlideTextBox | Record<string, unknown>, index: number): string {
  if (typeof box === 'object' && box) {
    const raw = 'text' in box ? box.text : 'content' in box ? box.content : ''
    return String(raw ?? '').trim()
  }
  return String(box ?? '').trim()
}

export function buildSpellingFields(slide: SlideRow): Array<{
  field_key: string
  text: string
}> {
  const fields: Array<{ field_key: string; text: string }> = []
  const screenText = normalizeScreenText(slide.screen_text)

  if (screenText?.length) {
    screenText.forEach((box, index) => {
      const text = boxText(box, index)
      if (text) {
        fields.push({
          field_key: `screen_text_${box.id || index}`,
          text,
        })
      }
    })
  } else {
    const combined = formatScreenText(slide.screen_text)
    if (combined.trim()) {
      fields.push({ field_key: 'screen_text', text: combined.trim() })
    }
  }

  const narrationText = formatNarration(slide.narration).trim()
  if (narrationText) {
    fields.push({ field_key: 'narration', text: narrationText })
  }

  return fields
}

export const NARRATION_FIELD_KEY = 'tr_narration'

export function buildTranslationFieldKeys(slide: SlideRow): Array<{
  field_key: string
  ko_text: string
}> {
  const fields: Array<{ field_key: string; ko_text: string }> = []
  const excluded = new Set(slide.excluded_fields ?? [])
  const screenText = normalizeScreenText(slide.screen_text)

  if (screenText?.length) {
    screenText.forEach((box, index) => {
      const text = boxText(box, index)
      if (text) {
        const field_key = `screen_text_${box.id || index}`
        if (!excluded.has(field_key)) {
          fields.push({ field_key, ko_text: text })
        }
      }
    })
  } else {
    const combined = formatScreenText(slide.screen_text)
    if (combined.trim() && !excluded.has('screen_text')) {
      fields.push({ field_key: 'screen_text', ko_text: combined })
    }
  }

  const narrationText = formatNarration(slide.narration).trim()
  if (narrationText && !excluded.has(NARRATION_FIELD_KEY) && !excluded.has('narration')) {
    fields.push({
      field_key: NARRATION_FIELD_KEY,
      ko_text: narrationText,
    })
  }

  return fields
}
