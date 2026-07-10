import type { Slide } from '../types'
import { normalizeScreenText, parseNarrationInput } from './pptxParser'

type SlideUpdate = Partial<
  Omit<Slide, 'id' | 'project_id' | 'slide_num' | 'created_at'>
>

export function applyFieldCorrection(
  slide: Slide,
  fieldKey: string,
  correctedText: string,
): SlideUpdate {
  if (fieldKey === 'narration') {
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
  if (fieldKey === 'tr_narration') return '나레이션 번역'
  if (fieldKey.startsWith('screen_text_')) return '화면텍스트'
  if (fieldKey === 'screen_text') return '화면텍스트'
  return fieldKey
}
