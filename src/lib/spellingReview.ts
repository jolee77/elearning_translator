import type { Slide, SpellingIssue, SpellingResult } from '../types'
import { formatNarration, formatScreenText, normalizeScreenText } from './pptxParser'
import { isOnlyLineBreakWhitespaceDiff } from './textDiff'

export type SpellableField = { field_key: string; text: string }

export type SpellingItemStatus = 'pending' | 'no_change' | 'applied' | 'skipped'

export type SlideSpellingCoverage =
  | 'pending_review'
  | 'all_clear'
  | 'reviewed'
  | 'no_text'
  | 'not_checked'

/** Edge Function buildSpellingFields와 동일한 대상 필드 목록 */
export function buildSpellableFields(slide: Slide): SpellableField[] {
  const fields: SpellableField[] = []
  const screenText = normalizeScreenText(slide.screen_text)

  if (screenText?.length) {
    screenText.forEach((box, index) => {
      const text = String(box.text ?? '').trim()
      if (text) {
        fields.push({
          field_key: `screen_text_${box.id || index}`,
          text,
        })
      }
    })
  } else {
    const combined = formatScreenText(slide.screen_text).trim()
    if (combined) {
      fields.push({ field_key: 'screen_text', text: combined })
    }
  }

  const narrationText = formatNarration(slide.narration).trim()
  if (narrationText) {
    fields.push({ field_key: 'narration', text: narrationText })
  }

  return fields
}

export function hasSpellingTextChanges(result: SpellingResult): boolean {
  if (isOnlyLineBreakWhitespaceDiff(result.original, result.suggestion)) return false
  return result.original.trim() !== result.suggestion.trim()
}

export function isSpellingPendingReview(result: SpellingResult): boolean {
  return hasSpellingTextChanges(result) && !result.applied && !result.skipped
}

export function getSpellingItemStatus(result: SpellingResult): SpellingItemStatus {
  if (result.applied) return 'applied'
  if (result.skipped) return 'skipped'
  if (hasSpellingTextChanges(result)) return 'pending'
  return 'no_change'
}

export function issueTypeLabel(type: string): string {
  switch (type) {
    case 'spelling':
    case 'spacing':
      return '맞춤법'
    case 'grammar':
      return '문법'
    case 'style':
      return '표기'
    default:
      return '검토'
  }
}

export function formatSpellingReviewReason(result: SpellingResult): string {
  const status = getSpellingItemStatus(result)

  if (status === 'no_change') {
    return '수정 불필요 — 맞춤법·띄어쓰기·문법상 문제가 발견되지 않았습니다.'
  }
  if (status === 'applied') {
    return '검토 완료 — 수정안을 슬라이드에 반영했습니다.'
  }
  if (status === 'skipped') {
    return '검토 완료 — 수정안을 적용하지 않기로 했습니다.'
  }

  const issues = result.issues ?? []
  if (issues.length > 0) {
    return issues
      .map((issue) => `[${issueTypeLabel(issue.type)}] ${issue.message}`)
      .join(' · ')
  }

  return '맞춤법·띄어쓰기·문법 등 수정이 제안되었습니다.'
}

export function getSlideSpellingCoverage(
  slide: Slide,
  results: SpellingResult[],
  checked: boolean,
): SlideSpellingCoverage {
  const spellable = buildSpellableFields(slide)
  if (spellable.length === 0) return 'no_text'
  if (!checked || results.length === 0) return 'not_checked'

  if (results.some(isSpellingPendingReview)) return 'pending_review'
  if (results.some(hasSpellingTextChanges)) return 'reviewed'
  return 'all_clear'
}

export function slideCoverageLabel(coverage: SlideSpellingCoverage): string {
  switch (coverage) {
    case 'pending_review':
      return '검토 필요'
    case 'all_clear':
      return '이상 없음'
    case 'reviewed':
      return '검토 완료'
    case 'no_text':
      return '검사 제외'
    case 'not_checked':
      return '미검사'
  }
}

export function slideCoverageReason(
  coverage: SlideSpellingCoverage,
  _slide: Slide,
  results: SpellingResult[],
): string {
  switch (coverage) {
    case 'no_text':
      return '화면텍스트와 나레이션이 모두 비어 있어 맞춤법 검사 대상에서 제외되었습니다.'
    case 'not_checked':
      return '맞춤법 검사를 실행하면 이 슬라이드도 함께 검사됩니다.'
    case 'pending_review':
      return `수정 제안 ${results.filter(isSpellingPendingReview).length}건 — 아래 항목을 확인해 주세요.`
    case 'all_clear':
      return '검사한 모든 필드에서 수정이 필요하지 않았습니다.'
    case 'reviewed':
      return '제안된 수정안을 모두 검토했습니다 (적용 또는 적용 안 함).'
  }
}

export function spellingItemBoxClass(status: SpellingItemStatus): string {
  switch (status) {
    case 'pending':
      return 'border-l-4 border-amber-500 bg-amber-50/90 ring-1 ring-amber-200/80'
    case 'applied':
      return 'border-l-4 border-emerald-500 bg-emerald-50/80'
    case 'skipped':
      return 'border-l-4 border-gray-300 bg-gray-50'
    case 'no_change':
      return 'border-l-4 border-sky-200 bg-sky-50/40'
  }
}

export function spellingSlideCardClass(coverage: SlideSpellingCoverage): string {
  switch (coverage) {
    case 'pending_review':
      return 'border-2 border-amber-400 shadow-sm shadow-amber-100'
    case 'all_clear':
      return 'border border-sky-200'
    case 'reviewed':
      return 'border border-emerald-200'
    case 'no_text':
      return 'border border-dashed border-gray-300 bg-gray-50/50'
    case 'not_checked':
      return 'border border-dashed border-gray-200'
  }
}

export function spellingStatusBadgeClass(coverage: SlideSpellingCoverage): string {
  switch (coverage) {
    case 'pending_review':
      return 'bg-amber-100 text-amber-900 ring-1 ring-amber-300'
    case 'all_clear':
      return 'bg-sky-100 text-sky-900'
    case 'reviewed':
      return 'bg-emerald-100 text-emerald-900'
    case 'no_text':
      return 'bg-gray-100 text-gray-600'
    case 'not_checked':
      return 'bg-gray-100 text-gray-500'
  }
}

export function normalizeSpellingIssues(raw: unknown): SpellingIssue[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is SpellingIssue => {
      return (
        typeof item === 'object' &&
        item !== null &&
        typeof (item as SpellingIssue).message === 'string'
      )
    })
    .map((item) => ({
      type: item.type ?? 'spelling',
      message: item.message,
      offset: item.offset,
      length: item.length,
    }))
}
