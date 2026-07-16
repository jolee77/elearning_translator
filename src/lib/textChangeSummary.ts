import type { ChangeLog, ExpertReviewItem, SpellingResult } from '../types'
import { fieldKeyLabel } from './slideFields'

export type TextChangeStage = 'spelling' | 'translation' | 'verification' | 'expert_review'

export const TEXT_CHANGE_STAGES: readonly {
  id: TextChangeStage
  label: string
}[] = [
  { id: 'spelling', label: '맞춤법' },
  { id: 'translation', label: '번역' },
  { id: 'verification', label: '역번역' },
  { id: 'expert_review', label: '전문가 검증' },
] as const

export interface TextChangeEntry {
  id: string
  stage: TextChangeStage
  slideId: string
  slideNum: number
  field: string
  fieldLabel: string
  before: string
  after: string
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim()
}

function isDifferent(before: string, after: string): boolean {
  return normalizeText(before) !== normalizeText(after)
}

/** 이벤트형 이력(단계 완료·다운로드 등) — 텍스트 변경과 구분 */
export function isEventChangeLog(log: ChangeLog): boolean {
  return Boolean(log.action) && !log.before_value && !log.after_value
}

function fromSpellingResults(
  results: SpellingResult[],
  slideNumById: Map<string, number>,
): TextChangeEntry[] {
  return results
    .filter((r) => r.committed_to_slide && isDifferent(r.original, r.suggestion))
    .map((r) => ({
      id: `spelling:${r.id}`,
      stage: 'spelling' as const,
      slideId: r.slide_id,
      slideNum: slideNumById.get(r.slide_id) ?? 0,
      field: r.field,
      fieldLabel: fieldKeyLabel(r.field),
      before: r.original,
      after: r.suggestion,
    }))
}

function fromExpertItems(
  items: ExpertReviewItem[],
  slideNumById: Map<string, number>,
): TextChangeEntry[] {
  return items
    .filter(
      (item) =>
        item.original_vi_text != null &&
        item.vi_text != null &&
        isDifferent(item.original_vi_text, item.vi_text),
    )
    .map((item) => ({
      id: `expert:${item.id}`,
      stage: 'expert_review' as const,
      slideId: item.slide_id,
      slideNum: slideNumById.get(item.slide_id) ?? 0,
      field: item.field,
      fieldLabel: fieldKeyLabel(item.field),
      before: item.original_vi_text!,
      after: item.vi_text!,
    }))
}

function fromFieldChangeLogs(
  logs: ChangeLog[],
  slideNumById: Map<string, number>,
): TextChangeEntry[] {
  const byKey = new Map<string, TextChangeEntry>()

  const sorted = [...logs]
    .filter(
      (log) =>
        log.stage &&
        log.field &&
        log.before_value != null &&
        log.after_value != null &&
        isDifferent(log.before_value, log.after_value),
    )
    .sort((a, b) => a.changed_at.localeCompare(b.changed_at))

  for (const log of sorted) {
    const stage = log.stage as TextChangeStage
    // 맞춤법·전문가는 전용 소스 우선 (중복 방지)
    if (stage === 'spelling' || stage === 'expert_review') continue

    const slideId = log.slide_id ?? ''
    const key = `${stage}:${slideId}:${log.field}`
    const existing = byKey.get(key)
    if (existing) {
      existing.after = log.after_value!
      continue
    }

    byKey.set(key, {
      id: `log:${log.id}`,
      stage,
      slideId,
      slideNum: log.slide_id ? (slideNumById.get(log.slide_id) ?? 0) : 0,
      field: log.field!,
      fieldLabel: fieldKeyLabel(log.field!),
      before: log.before_value!,
      after: log.after_value!,
    })
  }

  return [...byKey.values()]
}

export function buildTextChangeSummary(input: {
  spellingResults: SpellingResult[]
  expertItems: ExpertReviewItem[]
  changeLogs: ChangeLog[]
  slideNumById: Map<string, number>
}): Record<TextChangeStage, TextChangeEntry[]> {
  const entries = [
    ...fromSpellingResults(input.spellingResults, input.slideNumById),
    ...fromFieldChangeLogs(input.changeLogs, input.slideNumById),
    ...fromExpertItems(input.expertItems, input.slideNumById),
  ].sort((a, b) => {
    if (a.slideNum !== b.slideNum) return a.slideNum - b.slideNum
    return a.fieldLabel.localeCompare(b.fieldLabel, 'ko')
  })

  const grouped: Record<TextChangeStage, TextChangeEntry[]> = {
    spelling: [],
    translation: [],
    verification: [],
    expert_review: [],
  }

  for (const entry of entries) {
    grouped[entry.stage].push(entry)
  }

  return grouped
}

export function countTextChanges(
  grouped: Record<TextChangeStage, TextChangeEntry[]>,
): number {
  return TEXT_CHANGE_STAGES.reduce((sum, stage) => sum + grouped[stage.id].length, 0)
}
