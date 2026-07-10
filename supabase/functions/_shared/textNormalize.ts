interface SpellingIssue {
  type: string
  message: string
  offset?: number
  length?: number
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
  return { suggestion, issues }
}
