import { buildSuggestionRenderParts } from '../../lib/textDiff'

interface SuggestionHighlightProps {
  original: string
  suggestion: string
}

export function SuggestionHighlight({
  original,
  suggestion,
}: SuggestionHighlightProps) {
  const { changeKind, parts } = buildSuggestionRenderParts(original, suggestion)

  return (
    <div className="space-y-1">
      {changeKind === 'spacing' && (
        <span className="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
          띄어쓰기 오류
        </span>
      )}
      <p className="whitespace-pre-wrap text-sm">
        {parts.map((part, index) => {
          if (part.kind === 'space-insert') {
            return (
              <span
                key={index}
                className="mx-0.5 inline-block font-semibold text-red-600"
                title="띄어쓰기 추가"
              >
                {part.text}
              </span>
            )
          }

          if (part.kind === 'changed') {
            return (
              <span key={index} className="font-medium text-red-600">
                {part.text}
              </span>
            )
          }

          return (
            <span key={index} className="text-gray-800">
              {part.text}
            </span>
          )
        })}
      </p>
    </div>
  )
}
