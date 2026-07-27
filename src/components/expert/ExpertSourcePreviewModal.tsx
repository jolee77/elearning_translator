import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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

function previewBoxKey(box: PreviewBox): string {
  return `${box.kind}-${box.id}-${box.fieldKey}`
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

/** 원문에 명시적 줄바꿈이 없으면 미리보기에서도 한 줄로 표시 */
function hasExplicitLineBreak(text: string): boolean {
  return /\r?\n/.test(text)
}

/** 좌측 상단 부제목 밴드 (미리보기 좌측 정렬용) */
function isPreviewSubtitleBand(box: PreviewBox): boolean {
  if (box.kind !== 'screen') return false
  const xR = box.x / SB_CX
  const yR = box.y / SB_CY
  const yBottom = (box.y + Math.max(box.h, 1)) / SB_CY
  return xR < 0.55 && yR >= 0.05 && yR < 0.22 && yBottom <= 0.3
}

type PreviewLayout = {
  leftPct: number
  topPct: number | null
  bottomPct: number | null
  widthPct: number | 'auto'
  singleLine: boolean
}

function resolvePreviewLayout(box: PreviewBox): PreviewLayout {
  const singleLine = !hasExplicitLineBreak(box.text)
  let leftPct = (box.x / SB_CX) * 100
  let topPct: number | null = (box.y / SB_CY) * 100
  let bottomPct: number | null = null
  let widthPct: number | 'auto' = (Math.max(box.w, 1) / SB_CX) * 100

  // 나레이션: 하단 고정, 화면 폭에 맞춰 줄바꿈, 높이는 텍스트에 맞춤
  if (box.kind === 'narration') {
    leftPct = 1
    topPct = null
    bottomPct = 1.5
    widthPct = 98
    return { leftPct, topPct, bottomPct, widthPct, singleLine: false }
  }

  // 상단 부제목은 좌측에 붙임
  if (isPreviewSubtitleBand(box)) {
    leftPct = 1
  }

  if (singleLine) {
    widthPct = 'auto'
  }

  return { leftPct, topPct, bottomPct, widthPct, singleLine }
}

function rectsOverlap(
  aLeft: number,
  aTop: number,
  aW: number,
  aH: number,
  bLeft: number,
  bTop: number,
  bW: number,
  bH: number,
  gap: number,
): boolean {
  return !(
    aLeft + aW + gap <= bLeft ||
    bLeft + bW + gap <= aLeft ||
    aTop + aH + gap <= bTop ||
    bTop + bH + gap <= aTop
  )
}

function topsMapsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((k) => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < 0.05)
}

/** 측정된 박스 크기 기준으로 겹침을 아래로 밀어 해소 */
function resolveOverlappingTops(
  items: Array<{
    key: string
    left: number
    top: number
    width: number
    height: number
    isNarration: boolean
  }>,
): Record<string, number> {
  const GAP = 0.6
  const sorted = [...items].sort((a, b) => {
    if (a.isNarration !== b.isNarration) return a.isNarration ? 1 : -1
    return a.top - b.top || a.left - b.left
  })

  const placed: typeof items = []
  const tops: Record<string, number> = {}

  for (const item of sorted) {
    let top = item.top
    let changed = true
    let guard = 0
    while (changed && guard++ < 80) {
      changed = false
      for (const p of placed) {
        if (rectsOverlap(item.left, top, item.width, item.height, p.left, p.top, p.width, p.height, GAP)) {
          top = p.top + p.height + GAP
          changed = true
        }
      }
    }
    if (top + item.height > 99.5) {
      top = Math.max(0, 99.5 - item.height)
    }
    tops[item.key] = top
    placed.push({ ...item, top })
  }

  return tops
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
  const canvasRef = useRef<HTMLDivElement>(null)
  const boxElsRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const [adjustedTops, setAdjustedTops] = useState<Record<string, number>>({})

  const prepared = useMemo(
    () =>
      boxes.map((box) => {
        const key = previewBoxKey(box)
        const layout = resolvePreviewLayout(box)
        const maxWidthPct = Math.max(4, 100 - layout.leftPct - 1)
        return { box, key, layout, maxWidthPct }
      }),
    [boxes],
  )

  const boxesSig = useMemo(
    () => prepared.map((p) => `${p.key}:${p.box.text}`).join('|'),
    [prepared],
  )

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || prepared.length === 0) {
      setAdjustedTops((prev) => (Object.keys(prev).length === 0 ? prev : {}))
      return
    }

    const canvasW = canvas.clientWidth
    const canvasH = canvas.clientHeight
    if (canvasW <= 0 || canvasH <= 0) return

    const measured = prepared.flatMap(({ box, key, layout }) => {
      const el = boxElsRef.current.get(key)
      if (!el) return []
      const width = (el.offsetWidth / canvasW) * 100
      const height = (el.offsetHeight / canvasH) * 100
      const top =
        layout.topPct != null
          ? layout.topPct
          : Math.max(0, 100 - (layout.bottomPct ?? 0) - height)
      return [
        {
          key,
          left: layout.leftPct,
          top,
          width: Math.max(width, 0.5),
          height: Math.max(height, 0.5),
          isNarration: box.kind === 'narration',
        },
      ]
    })

    const next = resolveOverlappingTops(measured)
    setAdjustedTops((prev) => (topsMapsEqual(prev, next) ? prev : next))
  }, [prepared, boxesSig, adjustedTops])

  return (
    <div
      ref={canvasRef}
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

      {prepared.map(({ box, key, layout, maxWidthPct }) => {
        const isNarration = box.kind === 'narration'
        const hasAdjusted = adjustedTops[key] != null
        const topPct = hasAdjusted
          ? adjustedTops[key]
          : layout.topPct != null
            ? layout.topPct
            : undefined

        return (
          <div
            key={key}
            ref={(el) => {
              if (el) boxElsRef.current.set(key, el)
              else boxElsRef.current.delete(key)
            }}
            className={`absolute overflow-visible rounded border px-1 py-0.5 ${
              box.highlighted
                ? 'z-20 border-[#1E88E5] bg-[#e3f2fd] shadow-md ring-2 ring-[#1E88E5]'
                : isNarration
                  ? 'z-10 border-emerald-400/80 bg-[#e8f5e9]/95'
                  : 'z-10 border-gray-400/70 bg-white/90'
            }`}
            style={{
              left: `${layout.leftPct}%`,
              top: topPct != null ? `${topPct}%` : 'auto',
              bottom:
                !hasAdjusted && layout.bottomPct != null
                  ? `${layout.bottomPct}%`
                  : 'auto',
              width:
                layout.widthPct === 'auto'
                  ? 'auto'
                  : `${Math.max(layout.widthPct, 4)}%`,
              maxWidth: `${maxWidthPct}%`,
              height: 'auto',
              minHeight: '1.25em',
              fontSize: `${boxFontSizePx(box)}px`,
              lineHeight: 1.35,
            }}
            title={isNarration ? '나레이션' : '화면 텍스트'}
          >
            <p
              className={`text-gray-900 ${
                layout.singleLine
                  ? 'whitespace-nowrap'
                  : 'whitespace-pre-wrap break-words'
              }`}
            >
              {box.text}
            </p>
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
