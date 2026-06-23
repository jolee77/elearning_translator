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
  narration: string | null
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
  return normalized.map((box) => box.text).join('\n')
}

export function buildSpellingFields(slide: SlideRow): Array<{
  field_key: string
  text: string
}> {
  const fields: Array<{ field_key: string; text: string }> = []
  const screenText = normalizeScreenText(slide.screen_text)

  if (screenText?.length) {
    screenText.forEach((box, index) => {
      if (box.text.trim()) {
        fields.push({
          field_key: `screen_text_${box.id || index}`,
          text: box.text.trim(),
        })
      }
    })
  }

  if (slide.narration?.trim()) {
    fields.push({ field_key: 'narration', text: slide.narration.trim() })
  }

  return fields
}

export const NARRATION_FIELD_KEY = 'tr_narration'

export function buildTranslationFieldKeys(slide: SlideRow): Array<{
  field_key: string
  ko_text: string
}> {
  const fields: Array<{ field_key: string; ko_text: string }> = []
  const screenText = normalizeScreenText(slide.screen_text)

  if (screenText?.length) {
    screenText.forEach((box, index) => {
      if (box.text.trim()) {
        fields.push({
          field_key: `screen_text_${box.id || index}`,
          ko_text: box.text,
        })
      }
    })
  } else {
    const combined = formatScreenText(slide.screen_text)
    if (combined.trim()) {
      fields.push({ field_key: 'screen_text', ko_text: combined })
    }
  }

  if (slide.narration?.trim()) {
    fields.push({
      field_key: NARRATION_FIELD_KEY,
      ko_text: slide.narration.trim(),
    })
  }

  return fields
}
