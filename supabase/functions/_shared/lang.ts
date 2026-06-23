export const KO_CPM = 320

export const LANG_CONFIG: Record<string, { name: string; wpm: number }> = {
  vi: { name: '베트남어', wpm: 155 },
  en: { name: '영어', wpm: 150 },
  zh: { name: '중국어(간체)', wpm: 220 },
  ja: { name: '일본어', wpm: 400 },
  id: { name: '인도네시아어', wpm: 145 },
}

export function getLangConfig(targetLang: string) {
  const config = LANG_CONFIG[targetLang]
  if (!config) {
    throw new Error(`지원하지 않는 목표 언어입니다: ${targetLang}`)
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

export function calcKoCpm(koText: string): number {
  return countKoreanChars(koText)
}

export function calcTargetWpm(targetText: string): number {
  return countWords(targetText)
}

export function estimateKoDurationMinutes(koText: string): number {
  const chars = countKoreanChars(koText)
  if (chars === 0) return 0
  return chars / KO_CPM
}

export function estimateTargetDurationMinutes(targetText: string, targetLang: string): number {
  const words = countWords(targetText)
  if (words === 0) return 0
  return words / getLangConfig(targetLang).wpm
}
