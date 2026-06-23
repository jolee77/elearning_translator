export const KO_CPM = 320

export const LANG_CONFIG: Record<string, { name: string; wpm: number }> = {
  vi: { name: '베트남어', wpm: 155 },
  en: { name: '영어', wpm: 150 },
  zh: { name: '중국어(간체)', wpm: 220 },
  ja: { name: '일본어', wpm: 400 },
  id: { name: '인도네시아어', wpm: 145 },
}

export const NARRATION_FIELD_KEY = 'tr_narration'

export function getLangConfig(targetLang: string) {
  const config = LANG_CONFIG[targetLang]
  if (!config) {
    return { name: targetLang, wpm: 150 }
  }
  return config
}

export function countKoreanChars(text: string): number {
  return text.replace(/\s/g, '').length
}

export function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

export function estimateKoDurationSeconds(koText: string): number {
  const chars = countKoreanChars(koText)
  if (chars === 0) return 0
  return (chars / KO_CPM) * 60
}

export function estimateTargetDurationSeconds(targetText: string, targetLang: string): number {
  const words = countWords(targetText)
  if (words === 0) return 0
  return (words / getLangConfig(targetLang).wpm) * 60
}
