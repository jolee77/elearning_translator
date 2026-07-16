import { useMemo, useState } from 'react'
import {
  buildTextChangeSummary,
  countTextChanges,
  TEXT_CHANGE_STAGES,
  type TextChangeEntry,
  type TextChangeStage,
} from '../../lib/textChangeSummary'
import type { ChangeLog, ExpertReviewItem, SpellingResult } from '../../types'

interface TextChangeSummaryPanelProps {
  spellingResults: SpellingResult[]
  expertItems: ExpertReviewItem[]
  changeLogs: ChangeLog[]
  slideNumById: Map<string, number>
}

function ChangeRow({ entry }: { entry: TextChangeEntry }) {
  return (
    <li className="border-t border-gray-100 py-2.5 first:border-t-0">
      <p className="text-xs font-medium text-gray-700">
        슬라이드 {entry.slideNum || '-'} · {entry.fieldLabel}
      </p>
      <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
        <p className="rounded bg-gray-50 px-2 py-1.5 text-xs leading-relaxed text-gray-600">
          <span className="mr-1 font-medium text-gray-400">전</span>
          <span className="whitespace-pre-wrap break-words">{entry.before || '—'}</span>
        </p>
        <p className="rounded bg-amber-50 px-2 py-1.5 text-xs leading-relaxed text-amber-900">
          <span className="mr-1 font-medium text-amber-500">후</span>
          <span className="whitespace-pre-wrap break-words">{entry.after || '—'}</span>
        </p>
      </div>
    </li>
  )
}

function StageBlock({
  stageId,
  label,
  entries,
  defaultOpen,
}: {
  stageId: TextChangeStage
  label: string
  entries: TextChangeEntry[]
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 py-2.5 text-left"
        aria-expanded={open}
        aria-controls={`text-change-${stageId}`}
      >
        <span className="text-sm font-medium text-gray-800">{label}</span>
        <span className="flex items-center gap-2 text-xs text-gray-500">
          {entries.length > 0 ? `${entries.length}건` : '없음'}
          <span className="text-gray-400" aria-hidden>
            {open ? '▾' : '▸'}
          </span>
        </span>
      </button>
      {open && (
        <div id={`text-change-${stageId}`} className="pb-2">
          {entries.length === 0 ? (
            <p className="pb-2 text-xs text-gray-400">이 단계에서 수정된 텍스트가 없습니다.</p>
          ) : (
            <ul>
              {entries.map((entry) => (
                <ChangeRow key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export function TextChangeSummaryPanel({
  spellingResults,
  expertItems,
  changeLogs,
  slideNumById,
}: TextChangeSummaryPanelProps) {
  const grouped = useMemo(
    () =>
      buildTextChangeSummary({
        spellingResults,
        expertItems,
        changeLogs,
        slideNumById,
      }),
    [spellingResults, expertItems, changeLogs, slideNumById],
  )

  const total = countTextChanges(grouped)

  return (
    <div className="nb-card px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-gray-800">변경 내역</h4>
        <p className="text-xs text-gray-500">총 {total}건 · 아래 이벤트 이력과 별개</p>
      </div>
      <p className="mt-1 text-xs text-gray-400">
        맞춤법 → 번역 → 역번역 → 전문가 검증 순으로, 실제로 바뀐 텍스트만 모았습니다.
      </p>
      <div className="mt-2">
        {TEXT_CHANGE_STAGES.map((stage) => (
          <StageBlock
            key={stage.id}
            stageId={stage.id}
            label={stage.label}
            entries={grouped[stage.id]}
            defaultOpen={grouped[stage.id].length > 0}
          />
        ))}
      </div>
    </div>
  )
}
