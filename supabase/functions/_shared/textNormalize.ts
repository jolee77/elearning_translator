interface SpellingIssue {
  type: string
  message: string
  offset?: number
  length?: number
}

export function normalizeLineBreakWhitespace(text: string): string {
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]*/g, '\n')
}

export function isOnlyLineBreakWhitespaceDiff(a: string, b: string): boolean {
  if (a === b) return true

  const na = normalizeLineBreakWhitespace(a)
  const nb = normalizeLineBreakWhitespace(b)
  if (na.replace(/\n/g, '') !== nb.replace(/\n/g, '')) return false

  return a.replace(/\s/g, '') === b.replace(/\s/g, '')
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
