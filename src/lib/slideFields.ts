import type { Slide } from '../types'
import {
  formatNarration,
  formatScreenText,
  normalizeScreenText,
  parseNarrationInput,
} from './pptxParser'

type SlideUpdate = Partial<
  Omit<Slide, 'id' | 'project_id' | 'slide_num' | 'created_at'>
>

export const TRANSLATION_NARRATION_FIELD_KEY = 'tr_narration'

export type SelectableField = {
  field_key: string
  text: string
}

/** 번역 대상 선택·번역 Edge와 동일한 필드 목록 (제외 필터 전) */
export function buildSelectableFields(slide: Pick<Slide, 'screen_text' | 'narration'>): SelectableField[] {
  const fields: SelectableField[] = []
  const screenText = normalizeScreenText(slide.screen_text)

  if (screenText?.length) {
    screenText.forEach((box, index) => {
      const text = String(box.text ?? '').trim()
      if (text) {
        fields.push({
          field_key: `screen_text_${box.id || index}`,
          text,
        })
      }
    })
  } else {
    const combined = formatScreenText(slide.screen_text).trim()
    if (combined) {
      fields.push({ field_key: 'screen_text', text: combined })
    }
  }

  const narrationText = formatNarration(slide.narration).trim()
  if (narrationText) {
    fields.push({
      field_key: TRANSLATION_NARRATION_FIELD_KEY,
      text: narrationText,
    })
  }

  return fields
}

export function applyFieldCorrection(
  slide: Slide,
  fieldKey: string,
  correctedText: string,
): SlideUpdate {
  if (fieldKey === 'narration' || fieldKey === TRANSLATION_NARRATION_FIELD_KEY) {
    return { narration: parseNarrationInput(correctedText, slide.narration) }
  }

  const screenText = normalizeScreenText(slide.screen_text)

  if (fieldKey.startsWith('screen_text_')) {
    const boxId = fieldKey.replace('screen_text_', '')
    if (!screenText?.length) return {}

    const boxes = [...screenText]
    const idx = boxes.findIndex((box, index) => (box.id || String(index)) === boxId)

    if (idx >= 0) {
      boxes[idx] = { ...boxes[idx], text: correctedText }
      return { screen_text: boxes }
    }
  }

  if (fieldKey === 'screen_text' && screenText?.length) {
    const boxes = [...screenText]
    boxes[0] = { ...boxes[0], text: correctedText }
    return { screen_text: boxes }
  }

  return {}
}

export function fieldKeyLabel(fieldKey: string): string {
  if (fieldKey === 'narration') return '나레이션'
  if (fieldKey === 'tr_narration') return '나레이션'
  if (fieldKey.startsWith('screen_text_')) return '화면텍스트'
  if (fieldKey === 'screen_text') return '화면텍스트'
  return fieldKey
}
