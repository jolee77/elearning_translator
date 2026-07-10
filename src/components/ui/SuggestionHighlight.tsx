import { buildSpellingDiff, type SuggestionRenderPart } from '../../lib/textDiff'
import type { SpellingIssue } from '../../types'

interface SuggestionHighlightProps {
  original: string
  suggestion: string
  issues?: SpellingIssue[]
  mode: 'original' | 'suggestion'
}

function partClassName(kind: SuggestionRenderPart['kind'], mode: 'original' | 'suggestion'): string {
  switch (kind) {
    case 'delete':
      return 'font-medium text-red-600 line-through decoration-red-600'
    case 'space-insert':
      return 'mx-0.5 inline-block font-bold text-red-600'
    case 'insert':
    case 'changed':
      return 'font-medium text-red-600'
    case 'unchanged':
    default:
      return mode === 'original' ? 'text-gray-800' : 'text-gray-800'
  }
}

function renderPart(part: SuggestionRenderPart, index: number, mode: 'original' | 'suggestion') {
  return (
    <span key={index} className={partClassName(part.kind, mode)} title={partTitle(part.kind)}>
      {part.text}
    </span>
  )
}

function partTitle(kind: SuggestionRenderPart['kind']): string | undefined {
  switch (kind) {
    case 'delete':
      return '삭제'
    case 'space-insert':
      return '띄어쓰기 추가'
    case 'insert':
      return '추가'
    default:
      return undefined
  }
}

function issueTypeBadge(issues: SpellingIssue[]): string | null {
  const types = new Set(issues.map((i) => i.type))
  if (types.has('spacing')) return '띄어쓰기'
  if (types.has('spelling')) return '맞춤법'
  if (types.has('grammar')) return '문법'
  if (types.has('style')) return '표기'
  return issues.length > 0 ? '교정' : null
}

export function SuggestionHighlight({
  original,
  suggestion,
  issues = [],
  mode,
}: SuggestionHighlightProps) {
  const { changeKind, originalParts, suggestionParts } = buildSpellingDiff(original, suggestion)
  const parts = mode === 'original' ? originalParts : suggestionParts
  const badge = issueTypeBadge(issues)

  return (
    <div className="space-y-1">
      {badge && changeKind !== 'none' && (
        <span className="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
          {badge} 오류
        </span>
      )}
      <p className="whitespace-pre-wrap text-sm leading-relaxed">
        {parts.map((part, index) => renderPart(part, index, mode))}
      </p>
    </div>
  )
}
