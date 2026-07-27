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

type PreviewUnit =
  | { type: 'box'; box: PreviewBox }
  | {
      type: 'table'
      tableId: string
      boxes: PreviewBox[]
      x: number
      y: number
      w: number
      h: number
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

/** font_size는 파서에서 pt로 저장됨. */
function boxFontSizePx(box: SlideTextBox, kind: 'screen' | 'narration' = 'screen'): number {
  const hFrac = Math.max(box.h, 1) / SB_CY
  const wFrac = Math.max(box.w, 1) / SB_CX
  const text = String(box.text ?? '')
  const lines = text.split(/\r?\n/)
  const lineCount = Math.max(1, lines.length)
  const longest = Math.max(1, ...lines.map((l) => l.trim().length || 1))
  const charsPerLine = Math.max(6, wFrac * 88)
  const wrappedLines = lines.reduce(
    (sum, line) => sum + Math.max(1, Math.ceil((line.trim().length || 1) / charsPerLine)),
    0,
  )
  const estLines = Math.max(lineCount, wrappedLines)

  const fromHeight = (hFrac * 520) / (estLines * 1.35)
  const fromWidth = (wFrac * 900) / Math.max(longest * 0.62, 1)

  if (box.font_size && box.font_size > 0) {
    const pt =
      box.font_size > 40 ? box.font_size / 100 : box.font_size
    // 화면텍스트는 PPTX pt에 가깝게, 나레이션은 읽기 좋게 약간 축소
    const px = kind === 'narration' ? pt * 0.92 : pt
    return Math.max(kind === 'narration' ? 9 : 8, Math.min(kind === 'narration' ? 12 : 14, px))
  }

  const fallback = Math.max(6.5, Math.min(kind === 'narration' ? 11 : 12, fromHeight, fromWidth))
  return fallback
}

/** 원문에 명시적 줄바꿈이 없으면 한 줄로 표시 (박스 폭 안에서) */
function hasExplicitLineBreak(text: string): boolean {
  return /\r?\n/.test(text)
}

type PreviewLayout = {
  leftPct: number
  topPct: number
  widthPct: number
  singleLine: boolean
}

/** 화면텍스트: PPTX x/y/w 유지, 높이는 텍스트 분량에 맞춤 */
function resolvePreviewLayout(box: PreviewBox): PreviewLayout {
  const wFrac = Math.max(box.w, 1) / SB_CX
  const charsPerLine = Math.max(6, wFrac * 88)
  const singleLine =
    !hasExplicitLineBreak(box.text) && box.text.trim().length <= charsPerLine * 1.1

  return {
    leftPct: (box.x / SB_CX) * 100,
    topPct: (box.y / SB_CY) * 100,
    widthPct: (Math.max(box.w, 1) / SB_CX) * 100,
    singleLine,
  }
}

function geomKey(box: SlideTextBox): string {
  const q = (n: number) => Math.round(n / 5000) * 5000
  return `${q(box.x)}:${q(box.y)}:${q(box.w)}:${q(box.h)}`
}

/**
 * table_id가 있으면 표 단위로 묶고,
 * 구버전 추출(표 셀이 동일 좌표)은 같은 geometry 그룹을 표로 복원한다.
 */
function buildPreviewUnits(boxes: PreviewBox[]): PreviewUnit[] {
  const units: PreviewUnit[] = []
  const used = new Set<string>()

  const byTable = new Map<string, PreviewBox[]>()
  for (const box of boxes) {
    if (box.kind !== 'screen' || !box.table_id) continue
    const list = byTable.get(box.table_id) ?? []
    list.push(box)
    byTable.set(box.table_id, list)
  }

  for (const [tableId, cells] of byTable) {
    if (cells.length < 2) continue
    for (const c of cells) used.add(previewBoxKey(c))
    const x = Math.min(...cells.map((c) => c.x))
    const y = Math.min(...cells.map((c) => c.y))
    const x2 = Math.max(...cells.map((c) => c.x + Math.max(c.w, 1)))
    const y2 = Math.max(...cells.map((c) => c.y + Math.max(c.h, 1)))
    units.push({
      type: 'table',
      tableId,
      boxes: cells,
      x,
      y,
      w: Math.max(x2 - x, 1),
      h: Math.max(y2 - y, 1),
      highlighted: cells.some((c) => c.highlighted),
    })
  }

  const byGeom = new Map<string, PreviewBox[]>()
  for (const box of boxes) {
    if (used.has(previewBoxKey(box)) || box.kind !== 'screen') continue
    const key = geomKey(box)
    const list = byGeom.get(key) ?? []
    list.push(box)
    byGeom.set(key, list)
  }

  for (const [key, group] of byGeom) {
    if (group.length < 2) continue
    // 동일 좌표에 겹친 셀만 표로 복원 (의도적으로 겹친 일반 도형은 드묾)
    for (const c of group) used.add(previewBoxKey(c))
    const x = group[0].x
    const y = group[0].y
    const w = Math.max(group[0].w, 1)
    const h = Math.max(group[0].h, 1)
    units.push({
      type: 'table',
      tableId: `geom-${key}`,
      boxes: group,
      x,
      y,
      w,
      h,
      highlighted: group.some((c) => c.highlighted),
    })
  }

  for (const box of boxes) {
    if (used.has(previewBoxKey(box))) continue
    units.push({ type: 'box', box })
  }

  return units
}

function buildTableGrid(boxes: PreviewBox[]): PreviewBox[][] {
  const hasCoords = boxes.every(
    (b) => typeof b.table_row === 'number' && typeof b.table_col === 'number',
  )

  if (hasCoords) {
    const rowMap = new Map<number, Map<number, PreviewBox>>()
    for (const b of boxes) {
      const r = b.table_row!
      const c = b.table_col!
      if (!rowMap.has(r)) rowMap.set(r, new Map())
      rowMap.get(r)!.set(c, b)
    }
    const rows: PreviewBox[][] = []
    const rowKeys = [...rowMap.keys()].sort((a, b) => a - b)
    for (const r of rowKeys) {
      const cols = rowMap.get(r)!
      const colKeys = [...cols.keys()].sort((a, b) => a - b)
      rows.push(colKeys.map((c) => cols.get(c)!))
    }
    return rows
  }

  // 구버전: 동일 프레임에 쌓인 셀 → 한 열 표로 표시 (읽기 순서)
  return boxes.map((b) => [b])
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
    // 나레이션은 좌표 유무와 관계없이 하단 패널에 표시
    positioned.push(item)
  })

  return { positioned, unpositioned }
}

function PreviewText({ box, singleLine }: { box: PreviewBox; singleLine: boolean }) {
  return (
    <p
      className={`text-gray-900 ${
        singleLine
          ? 'overflow-hidden text-ellipsis whitespace-nowrap'
          : 'whitespace-pre-wrap break-words'
      }`}
      style={{ fontSize: 'inherit', lineHeight: 'inherit' }}
    >
      {box.text}
    </p>
  )
}

function NarrationPanel({ boxes }: { boxes: PreviewBox[] }) {
  if (boxes.length === 0) return null

  return (
    <div className="absolute bottom-0 left-0 right-0 z-30 max-h-[45%] overflow-y-auto border-t border-emerald-500/80 bg-[#e8f5e9]/95 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
      {boxes.map((box) => (
        <div
          key={previewBoxKey(box)}
          className={`px-2 py-1.5 ${
            box.highlighted ? 'border-l-4 border-[#1E88E5] bg-[#e3f2fd]/95' : ''
          }`}
          style={{
            fontSize: `${boxFontSizePx(box, 'narration')}px`,
            lineHeight: 1.45,
          }}
        >
          <p className="whitespace-pre-wrap break-words text-gray-900">{box.text}</p>
        </div>
      ))}
    </div>
  )
}

function TablePreview({
  unit,
}: {
  unit: Extract<PreviewUnit, { type: 'table' }>
}) {
  const grid = buildTableGrid(unit.boxes)
  const fontPx = Math.min(...unit.boxes.map((b) => boxFontSizePx(b, 'screen')), 10)

  return (
    <div
      className={`absolute overflow-hidden rounded border ${
        unit.highlighted
          ? 'z-20 border-[#1E88E5] bg-[#e3f2fd] shadow-md ring-2 ring-[#1E88E5]'
          : 'z-10 border-gray-500/80 bg-white/95'
      }`}
      style={{
        left: `${(unit.x / SB_CX) * 100}%`,
        top: `${(unit.y / SB_CY) * 100}%`,
        width: `${(Math.max(unit.w, 1) / SB_CX) * 100}%`,
        height: `${(Math.max(unit.h, 1) / SB_CY) * 100}%`,
        fontSize: `${fontPx}px`,
        lineHeight: 1.25,
      }}
      title={unit.boxes.map((b) => b.text).join(' | ')}
    >
      <table className="h-full w-full border-collapse table-fixed">
        <tbody>
          {grid.map((row, ri) => (
            <tr key={`r-${ri}`}>
              {row.map((cell) => (
                <td
                  key={previewBoxKey(cell)}
                  className={`align-top border border-gray-300/80 px-1 py-0.5 ${
                    cell.highlighted ? 'bg-[#e3f2fd]' : 'bg-white/90'
                  }`}
                  style={{
                    fontSize: `${boxFontSizePx(cell, 'screen')}px`,
                    width: `${100 / Math.max(row.length, 1)}%`,
                  }}
                >
                  <PreviewText
                    box={cell}
                    singleLine={!hasExplicitLineBreak(cell.text) && cell.text.length < 28}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SlideLayoutCanvas({
  boxes,
}: {
  boxes: PreviewBox[]
}) {
  const screenBoxes = useMemo(
    () => boxes.filter((b) => b.kind === 'screen'),
    [boxes],
  )
  const narrationBoxes = useMemo(
    () => boxes.filter((b) => b.kind === 'narration'),
    [boxes],
  )
  const units = useMemo(() => buildPreviewUnits(screenBoxes), [screenBoxes])

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

      {units.map((unit) => {
        if (unit.type === 'table') {
          return <TablePreview key={`table-${unit.tableId}`} unit={unit} />
        }

        const box = unit.box
        const layout = resolvePreviewLayout(box)
        const fontPx = boxFontSizePx(box, 'screen')

        return (
          <div
            key={previewBoxKey(box)}
            className={`absolute rounded border px-0.5 py-0 ${
              box.highlighted
                ? 'z-20 border-[#1E88E5] bg-[#e3f2fd]/90 shadow-md ring-2 ring-[#1E88E5]'
                : 'z-10 border-gray-400/70 bg-white/70'
            }`}
            style={{
              left: `${layout.leftPct}%`,
              top: `${layout.topPct}%`,
              width: `${Math.max(layout.widthPct, 1)}%`,
              height: 'auto',
              fontSize: `${fontPx}px`,
              lineHeight: 1.25,
            }}
            title={box.text}
          >
            <PreviewText box={box} singleLine={layout.singleLine} />
          </div>
        )
      })}

      {screenBoxes.length === 0 && narrationBoxes.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">
          배치할 텍스트 박스가 없습니다
        </p>
      )}

      <NarrationPanel boxes={narrationBoxes} />
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
              PPTX에서 추출한 좌표로 텍스트 박스 위치를 대략 재현합니다. 표는 셀 단위로 묶어 표시합니다.
              배경·이미지는 포함되지 않으며, ← → 키로 슬라이드를 이동할 수 있습니다.
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
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded border border-gray-500 bg-white" />
                표
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
