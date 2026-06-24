export interface TextDiffSegment {
  text: string
  changed: boolean
}

export type SpellingChangeKind = 'none' | 'spacing' | 'text'

export interface SuggestionRenderPart {
  text: string
  kind: 'unchanged' | 'space-insert' | 'changed'
}

export function detectSpellingChangeKind(
  original: string,
  suggestion: string,
): SpellingChangeKind {
  if (original === suggestion) return 'none'
  if (original.replace(/\s/g, '') === suggestion.replace(/\s/g, '')) return 'spacing'
  return 'text'
}

/** AI 수정안에서 원문과 다른 구간만 changed=true로 반환 */
export function diffSuggestionSegments(
  original: string,
  suggestion: string,
): TextDiffSegment[] {
  if (original === suggestion) {
    return suggestion ? [{ text: suggestion, changed: false }] : []
  }

  const a = original
  const b = suggestion
  const n = a.length
  const m = b.length

  const dp = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0))

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  const inLcs = Array<boolean>(m).fill(false)
  let i = n
  let j = m

  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      inLcs[j - 1] = true
      i -= 1
      j -= 1
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i -= 1
    } else {
      j -= 1
    }
  }

  const segments: TextDiffSegment[] = []

  for (let idx = 0; idx < m; idx++) {
    const changed = !inLcs[idx]
    const last = segments[segments.length - 1]

    if (last && last.changed === changed) {
      last.text += b[idx]
    } else {
      segments.push({ text: b[idx], changed })
    }
  }

  return segments
}

function isWhitespace(char: string): boolean {
  return /\s/.test(char)
}

function spaceMarker(char: string): string {
  if (char === '\n') return '↵'
  if (char === '\t') return '⇥'
  return '^'
}

function buildSpacingSuggestionParts(
  original: string,
  suggestion: string,
): SuggestionRenderPart[] {
  const parts: SuggestionRenderPart[] = []
  let buffer = ''
  let i = 0
  let j = 0

  const flush = (kind: 'unchanged' | 'changed') => {
    if (!buffer) return
    parts.push({ text: buffer, kind })
    buffer = ''
  }

  while (j < suggestion.length) {
    const suggestionChar = suggestion[j]
    const originalChar = i < original.length ? original[i] : null

    if (originalChar === suggestionChar) {
      buffer += suggestionChar
      i += 1
      j += 1
      continue
    }

    if (isWhitespace(suggestionChar)) {
      flush('unchanged')
      parts.push({ text: spaceMarker(suggestionChar), kind: 'space-insert' })
      j += 1
      continue
    }

    if (originalChar != null && isWhitespace(originalChar)) {
      i += 1
      continue
    }

    flush('unchanged')
    buffer += suggestionChar
    j += 1
  }

  flush('unchanged')
  return parts
}

export function buildSuggestionRenderParts(
  original: string,
  suggestion: string,
): { changeKind: SpellingChangeKind; parts: SuggestionRenderPart[] } {
  const changeKind = detectSpellingChangeKind(original, suggestion)

  if (changeKind === 'none') {
    return {
      changeKind,
      parts: suggestion ? [{ text: suggestion, kind: 'unchanged' }] : [],
    }
  }

  if (changeKind === 'spacing') {
    return {
      changeKind,
      parts: buildSpacingSuggestionParts(original, suggestion),
    }
  }

  return {
    changeKind,
    parts: diffSuggestionSegments(original, suggestion).map((segment) => ({
      text: segment.text,
      kind: segment.changed ? 'changed' : 'unchanged',
    })),
  }
}
