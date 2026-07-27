import { useEffect, useMemo, useState } from 'react'
import {
  SB_CX,
  SB_CY,
  normalizeNarration,
  normalizeScreenText,
} from '../../lib/pptxParser'
import { fieldKeyLabel } from '../../lib/slideFields'
import type { ExpertReviewSlideInfo, SlideTextBox } from '../../types'

interface ExpertSourcePreviewModalProps {
  open: boolean
  onClose: () => void
  slides: ExpertReviewSlideInfo[]
  /** 현재 검토 중인 슬라이드 id — 열릴 때 해당 슬라이드 표시 */
  focusSlideId?: string | null
  /** 강조할 필드 (screen_text_* / tr_narration 등) */
  highlightField?: string | null
}

type PreviewBox = SlideTextBox & {
  kind: 'screen' | 'narration'
  fieldKey: string
  highlighted: boolean
}

function isNarrationField(field: string | null | undefined): boolean {
  return field === 'tr_narration' || field === 'narration'
}

function screenFieldKey(box: SlideTextBox, index: number): string {
  return `screen_text_${box.id || index}`
}

function hasGeometry(box: SlideTextBox): boolean {
  return box.w > 0 && box.h > 0
}

function boxFontSizePx(box: SlideTextBox): number {
  // OOXML sz는 1/100 pt. 미리보기 캔버스 기준으로 대략 환산
  if (box.font_size && box.font_size > 0) {
    return Math.max(9, Math.min(20, box.font_size / 100))
  }
  const hRatio = Math.max(box.h, 1) / SB_CY
  return Math.max(9, Math.min(16, hRatio * 420))
}

function buildPreviewBoxes(
  slide: ExpertReviewSlideInfo,
  highlightField: string | null | undefined,
  isFocusSlide: boolean,
): { positioned: PreviewBox[]; unpositioned: PreviewBox[] } {
  const positioned: PreviewBox[] = []
  const unpositioned: PreviewBox[] = []

  const screenBoxes = normalizeScreenText(slide.screen_text) ?? []
  screenBoxes.forEach((box, index) => {
    const text = String(box.text ?? '').trim()
    if (!text) return
    const fieldKey = screenFieldKey(box, index)
    const highlighted =
      isFocusSlide &&
      Boolean(
        highlightField === fieldKey ||
          highlightField === 'screen_text' ||
          (highlightField?.startsWith('screen_text_') &&
            highlightField === fieldKey),
      )
    const item: PreviewBox = {
      ...box,
      kind: 'screen',
      fieldKey,
      highlighted,
      text,
    }
    if (hasGeometry(box)) positioned.push(item)
    else unpositioned.push(item)
  })

  const narrationBoxes = normalizeNarration(slide.narration) ?? []
  narrationBoxes.forEach((box, index) => {
    const text = String(box.text ?? '').trim()
    if (!text) return
    const fieldKey = 'tr_narration'
    const highlighted = isFocusSlide && isNarrationField(highlightField)
    const item: PreviewBox = {
      ...box,
      id: box.id || `n${index}`,
      kind: 'narration',
      fieldKey,
      highlighted,
      text,
    }
    if (hasGeometry(box)) positioned.push(item)
    else unpositioned.push(item)
  })

  return { positioned, unpositioned }
}

function SlideLayoutCanvas({
  boxes,
}: {
  boxes: PreviewBox[]
}) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-lg border border-gray-300 bg-[#fafafa] shadow-inner"
      style={{ aspectRatio: `${SB_CX} / ${SB_CY}` }}
    >
      {/* 약한 가이드 그리드 */}
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'linear-gradient(to right, #e5e7eb 1px, transparent 1px), linear-gradient(to bottom, #e5e7eb 1px, transparent 1px)',
          backgroundSize: '10% 10%',
        }}
      />

      {boxes.map((box) => {
        const left = (box.x / SB_CX) * 100
        const top = (box.y / SB_CY) * 100
        const width = (Math.max(box.w, 1) / SB_CX) * 100
        const height = (Math.max(box.h, 1) / SB_CY) * 100
        const isNarration = box.kind === 'narration'

        return (
          <div
            key={`${box.kind}-${box.id}-${box.fieldKey}`}
            className={`absolute overflow-auto rounded border px-1 py-0.5 ${
              box.highlighted
                ? 'z-20 border-[#1E88E5] bg-[#e3f2fd] shadow-md ring-2 ring-[#1E88E5]'
                : isNarration
                  ? 'z-10 border-emerald-400/80 bg-[#e8f5e9]/95'
                  : 'z-10 border-gray-400/70 bg-white/90'
            }`}
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: `${Math.max(width, 4)}%`,
              height: `${Math.max(height, 3)}%`,
              minHeight: '1.1em',
              fontSize: `${boxFontSizePx(box)}px`,
              lineHeight: 1.35,
            }}
            title={isNarration ? '나레이션' : '화면 텍스트'}
          >
            <p className="whitespace-pre-wrap break-words text-gray-900">{box.text}</p>
          </div>
        )
      })}

      {boxes.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">
          배치할 텍스트 박스가 없습니다
        </p>
      )}
    </div>
  )
}

export function ExpertSourcePreviewModal({
  open,
  onClose,
  slides,
  focusSlideId,
  highlightField,
}: ExpertSourcePreviewModalProps) {
  const sorted = useMemo(
    () => [...slides].sort((a, b) => a.slide_num - b.slide_num),
    [slides],
  )

  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const initial =
      (focusSlideId && sorted.some((s) => s.id === focusSlideId) ? focusSlideId : null) ??
      sorted[0]?.id ??
      null
    setActiveId(initial)
  }, [open, focusSlideId, sorted])

  useEffect(() => {
    if (!open) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        setActiveId((prev) => {
          const idx = sorted.findIndex((s) => s.id === prev)
          if (idx < 0) return prev
          const next =
            e.key === 'ArrowLeft'
              ? sorted[Math.max(0, idx - 1)]
              : sorted[Math.min(sorted.length - 1, idx + 1)]
          return next?.id ?? prev
        })
      }
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose, sorted])

  const activeIndex = sorted.findIndex((s) => s.id === activeId)
  const activeSlide = activeIndex >= 0 ? sorted[activeIndex] : null

  const { positioned, unpositioned } = useMemo(() => {
    if (!activeSlide) return { positioned: [], unpositioned: [] }
    return buildPreviewBoxes(
      activeSlide,
      highlightField,
      activeSlide.id === focusSlideId,
    )
  }, [activeSlide, highlightField, focusSlideId])

  if (!open) return null

  const goPrev = () => {
    if (activeIndex <= 0) return
    setActiveId(sorted[activeIndex - 1].id)
  }
  const goNext = () => {
    if (activeIndex < 0 || activeIndex >= sorted.length - 1) return
    setActiveId(sorted[activeIndex + 1].id)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="expert-source-preview-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="닫기"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
          <div>
            <h2
              id="expert-source-preview-title"
              className="text-base font-semibold text-gray-900"
            >
              맞춤법 반영 원문 (슬라이드 배치)
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              PPTX에서 추출한 좌표로 텍스트 박스 위치를 대략 재현합니다. 배경·이미지는 포함되지
              않으며, ← → 키로 슬라이드를 이동할 수 있습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-800"
          >
            닫기
          </button>
        </div>

        {sorted.length === 0 || !activeSlide ? (
          <div className="p-8 text-center text-sm text-gray-500">
            표시할 슬라이드가 없습니다.
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={activeIndex <= 0}
                  className="nb-btn-secondary text-xs disabled:opacity-40"
                >
                  ← 이전
                </button>
                <select
                  className="nb-input max-w-[14rem] py-1.5 text-sm"
                  value={activeSlide.id}
                  onChange={(e) => setActiveId(e.target.value)}
                  aria-label="슬라이드 선택"
                >
                  {sorted.map((s) => (
                    <option key={s.id} value={s.id}>
                      슬라이드 {s.slide_num}
                      {s.screen_num ? ` (${s.screen_num})` : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={activeIndex >= sorted.length - 1}
                  className="nb-btn-secondary text-xs disabled:opacity-40"
                >
                  다음 →
                </button>
                <span className="text-xs text-gray-500">
                  {activeIndex + 1} / {sorted.length}
                </span>
              </div>
              {activeSlide.id === focusSlideId && highlightField && (
                <span className="nb-badge nb-badge--pending text-xs">
                  검토 중: {fieldKeyLabel(highlightField)}
                </span>
              )}
            </div>

            {(activeSlide.course_name ||
              activeSlide.chapter_name ||
              activeSlide.current_section) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                {activeSlide.course_name && <span>과정명: {activeSlide.course_name}</span>}
                {activeSlide.chapter_name && <span>회차명: {activeSlide.chapter_name}</span>}
                {activeSlide.current_section && (
                  <span>목차: {activeSlide.current_section}</span>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded border border-gray-400 bg-white" />
                화면 텍스트
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded border border-emerald-400 bg-[#e8f5e9]" />
                나레이션
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded border border-[#1E88E5] bg-[#e3f2fd]" />
                검토 중 항목
              </span>
            </div>

            <SlideLayoutCanvas boxes={positioned} />

            {unpositioned.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3">
                <p className="text-xs font-medium text-amber-800">
                  좌표 정보가 없어 아래에 나열합니다
                </p>
                <ul className="mt-2 space-y-2">
                  {unpositioned.map((box) => (
                    <li
                      key={`u-${box.kind}-${box.id}`}
                      className={`whitespace-pre-wrap rounded border bg-white p-2 text-sm ${
                        box.highlighted
                          ? 'border-[#1E88E5] ring-1 ring-[#1E88E5]'
                          : 'border-gray-200'
                      }`}
                    >
                      <span className="mb-1 block text-[11px] text-gray-500">
                        {box.kind === 'narration' ? '나레이션' : '화면 텍스트'}
                      </span>
                      {box.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
