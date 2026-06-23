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
  screen_text: SlideTextBox[] | null
  narration: string | null
}

export function formatScreenText(screenText: SlideTextBox[] | null): string {
  if (!screenText?.length) return ''
  return screenText.map((box) => box.text).join('\n')
}

export function buildSpellingFields(slide: SlideRow): Array<{
  field_key: string
  text: string
}> {
  const fields: Array<{ field_key: string; text: string }> = []

  if (slide.screen_text?.length) {
    slide.screen_text.forEach((box, index) => {
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

  if (slide.screen_text?.length) {
    slide.screen_text.forEach((box, index) => {
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
