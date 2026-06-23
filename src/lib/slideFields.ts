import type { Slide } from '../types'

type SlideUpdate = Partial<
  Omit<Slide, 'id' | 'project_id' | 'slide_num' | 'created_at'>
>

export function applyFieldCorrection(
  slide: Slide,
  fieldKey: string,
  correctedText: string,
): SlideUpdate {
  if (fieldKey === 'narration') {
    return { narration: correctedText }
  }

  if (fieldKey.startsWith('screen_text_')) {
    const boxId = fieldKey.replace('screen_text_', '')
    const screenText = slide.screen_text ? [...slide.screen_text] : []
    const idx = screenText.findIndex((box, index) => (box.id || String(index)) === boxId)

    if (idx >= 0) {
      screenText[idx] = { ...screenText[idx], text: correctedText }
      return { screen_text: screenText }
    }
  }

  if (fieldKey === 'screen_text' && slide.screen_text?.length) {
    const screenText = [...slide.screen_text]
    screenText[0] = { ...screenText[0], text: correctedText }
    return { screen_text: screenText }
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
