interface SpellingIssue {
  type: string
  message: string
  offset?: number
  length?: number
}

/** 공백 제거 — 띄어쓰기만 다른지 판별용 */
export function stripWhitespace(text: string): string {
  return text.replace(/\s+/g, '')
}

export function normalizeLineBreakWhitespace(text: string): string {
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]*/g, '\n')
}

export function normalizeScreenTextForSpellingCompare(text: string): string {
  return normalizeLineBreakWhitespace(text)
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isOnlyLineBreakWhitespaceDiff(a: string, b: string): boolean {
  if (a === b) return true
  return (
    normalizeScreenTextForSpellingCompare(a) === normalizeScreenTextForSpellingCompare(b)
  )
}

/** Levenshtein 거리 (짧은 문자열용) */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  const n = a.length
  const m = b.length
  let prev = Array.from({ length: m + 1 }, (_, j) => j)
  let curr = new Array<number>(m + 1)

  for (let i = 1; i <= n; i++) {
    curr[0] = i
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      )
    }
    ;[prev, curr] = [curr, prev]
  }

  return prev[m]
}

/**
 * AI가 문장·표현을 통째로 바꾼 경우 감지.
 * 띄어쓰기만 다른 경우는 false.
 * 짧은 오자(1~수 글자)는 허용하고, 긴 텍스트의 광범위한 재작성만 거절.
 */
export function isExcessiveSpellingRewrite(original: string, suggestion: string): boolean {
  if (original === suggestion) return false
  if (isOnlyLineBreakWhitespaceDiff(original, suggestion)) return false

  const compactA = stripWhitespace(original)
  const compactB = stripWhitespace(suggestion)
  if (compactA === compactB) return false // 띄어쓰기만 변경

  const dist = levenshteinDistance(compactA, compactB)
  const maxLen = Math.max(compactA.length, compactB.length, 1)
  // 절대 2글자까지는 오자·탈자로 허용 (되요→돼요, 잇다→있다 등)
  // 그 이상은 비공백 길이의 12%를 넘는 변경이면 문장·표현 재작성으로 거절
  const allowed = Math.max(2, Math.floor(maxLen * 0.12))
  return dist > allowed
}

export function sanitizeSpellingField(
  original: string,
  suggestion: string,
  issues: SpellingIssue[],
): { suggestion: string; issues: SpellingIssue[] } {
  if (isOnlyLineBreakWhitespaceDiff(original, suggestion)) {
    return {
      suggestion: original,
      issues: issues.filter((issue) => issue.type !== 'spacing'),
    }
  }

  // 문장 통째 재작성·표현 개선 제안은 버리고 원문 유지
  if (isExcessiveSpellingRewrite(original, suggestion)) {
    return { suggestion: original, issues: [] }
  }

  return { suggestion, issues }
}
