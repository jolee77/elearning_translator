import { diffSuggestionSegments } from '../../lib/textDiff'

interface SuggestionHighlightProps {
  original: string
  suggestion: string
  highlightChanges?: boolean
}

export function SuggestionHighlight({
  original,
  suggestion,
  highlightChanges = true,
}: SuggestionHighlightProps) {
  if (!highlightChanges || original.trim() === suggestion.trim()) {
    return <span className="text-gray-800">{suggestion}</span>
  }

  const segments = diffSuggestionSegments(original, suggestion)

  return (
    <>
      {segments.map((segment, index) =>
        segment.changed ? (
          <span key={index} className="font-medium text-red-600">
            {segment.text}
          </span>
        ) : (
          <span key={index} className="text-gray-800">
            {segment.text}
          </span>
        ),
      )}
    </>
  )
}
