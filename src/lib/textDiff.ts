export interface TextDiffSegment {
  text: string
  changed: boolean
}

export type SpellingChangeKind = 'none' | 'spacing' | 'text'

export type SuggestionRenderPartKind =
  | 'unchanged'
  | 'space-insert'
  | 'insert'
  | 'delete'
  | 'changed'

export interface SuggestionRenderPart {
  text: string
  kind: SuggestionRenderPartKind
}

export interface SpellingDiffView {
  changeKind: SpellingChangeKind
  originalParts: SuggestionRenderPart[]
  suggestionParts: SuggestionRenderPart[]
}

/** 줄바꿈 앞뒤 공백 정리 (화면텍스트 줄나눔 표현용) */
export function normalizeLineBreakWhitespace(text: string): string {
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]*/g, '\n')
}

/** 줄바꿈·행 끝 공백만 다른 경우 — 띄어쓰기 오류로 보지 않음 */
export function isOnlyLineBreakWhitespaceDiff(a: string, b: string): boolean {
  if (a === b) return true

  const na = normalizeLineBreakWhitespace(a)
  const nb = normalizeLineBreakWhitespace(b)
  if (na.replace(/\n/g, '') !== nb.replace(/\n/g, '')) return false

  return a.replace(/\s/g, '') === b.replace(/\s/g, '')
}

export function detectSpellingChangeKind(
  original: string,
  suggestion: string,
): SpellingChangeKind {
  if (original === suggestion) return 'none'
  if (isOnlyLineBreakWhitespaceDiff(original, suggestion)) return 'none'
  if (original.replace(/\s/g, '') === suggestion.replace(/\s/g, '')) return 'spacing'
  return 'text'
}

type DiffOp =
  | { type: 'equal'; text: string }
  | { type: 'delete'; text: string }
  | { type: 'insert'; text: string }

function mergeDiffOps(ops: DiffOp[]): DiffOp[] {
  const merged: DiffOp[] = []
  for (const op of ops) {
    const last = merged[merged.length - 1]
    if (last && last.type === op.type && op.type !== 'equal') {
      last.text += op.text
    } else if (last && last.type === 'equal' && op.type === 'equal') {
      last.text += op.text
    } else {
      merged.push({ ...op })
    }
  }
  return merged
}

function diffOperations(original: string, suggestion: string): DiffOp[] {
  if (original === suggestion) {
    return original ? [{ type: 'equal', text: original }] : []
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

  const reversed: DiffOp[] = []
  let i = n
  let j = m

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      reversed.push({ type: 'equal', text: a[i - 1] })
      i -= 1
      j -= 1
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      reversed.push({ type: 'insert', text: b[j - 1] })
      j -= 1
    } else {
      reversed.push({ type: 'delete', text: a[i - 1] })
      i -= 1
    }
  }

  return mergeDiffOps(reversed.reverse())
}

function isWhitespace(char: string): boolean {
  return /\s/.test(char)
}

function spaceMarker(char: string): string {
  if (char === '\n') return '↵'
  if (char === '\t') return '⇥'
  return '▲'
}

function mapInsertPart(text: string, changeKind: SpellingChangeKind): SuggestionRenderPart[] {
  if (!text) return []
  if (changeKind === 'spacing' && [...text].every(isWhitespace)) {
    return [...text].map((char) => ({
      text: spaceMarker(char),
      kind: 'space-insert' as const,
    }))
  }
  return [{ text, kind: 'insert' as const }]
}

function buildViewParts(
  original: string,
  suggestion: string,
  changeKind: SpellingChangeKind,
): Pick<SpellingDiffView, 'originalParts' | 'suggestionParts'> {
  if (changeKind === 'none') {
    const text = original || suggestion
    return {
      originalParts: text ? [{ text, kind: 'unchanged' }] : [],
      suggestionParts: text ? [{ text, kind: 'unchanged' }] : [],
    }
  }

  const ops = diffOperations(original, suggestion)
  const originalParts: SuggestionRenderPart[] = []
  const suggestionParts: SuggestionRenderPart[] = []

  for (const op of ops) {
    if (op.type === 'equal') {
      originalParts.push({ text: op.text, kind: 'unchanged' })
      suggestionParts.push({ text: op.text, kind: 'unchanged' })
      continue
    }

    if (op.type === 'delete') {
      if (changeKind === 'spacing' && [...op.text].every(isWhitespace)) {
        for (const char of op.text) {
          originalParts.push({
            text: char === ' ' ? '·' : spaceMarker(char),
            kind: 'delete',
          })
        }
      } else {
        originalParts.push({ text: op.text, kind: 'delete' })
      }
      continue
    }

    suggestionParts.push(...mapInsertPart(op.text, changeKind))
  }

  return { originalParts, suggestionParts }
}

export function buildSpellingDiff(
  original: string,
  suggestion: string,
): SpellingDiffView {
  const changeKind = detectSpellingChangeKind(original, suggestion)
  const { originalParts, suggestionParts } = buildViewParts(
    original,
    suggestion,
    changeKind,
  )

  return { changeKind, originalParts, suggestionParts }
}

/** @deprecated buildSpellingDiff 사용 */
export function buildSuggestionRenderParts(
  original: string,
  suggestion: string,
): { changeKind: SpellingChangeKind; parts: SuggestionRenderPart[] } {
  const diff = buildSpellingDiff(original, suggestion)
  return { changeKind: diff.changeKind, parts: diff.suggestionParts }
}

/** AI 수정안에서 원문과 다른 구간만 changed=true로 반환 */
export function diffSuggestionSegments(
  original: string,
  suggestion: string,
): TextDiffSegment[] {
  const { suggestionParts } = buildSpellingDiff(original, suggestion)
  return suggestionParts.map((part) => ({
    text: part.text,
    changed: part.kind !== 'unchanged',
  }))
}
