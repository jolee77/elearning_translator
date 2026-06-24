export interface TextDiffSegment {
  text: string
  changed: boolean
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
