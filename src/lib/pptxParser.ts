import JSZip from 'jszip'
import type { SlideTextBox, SlideType } from '../types'

export const SB_CX = 12_192_000
export const SB_CY = 6_858_000

export interface ParsedSlide {
  slide_num: number
  slide_type: SlideType
  screen_num: string | null
  course_name: string | null
  chapter_name: string | null
  current_section: string | null
  screen_text: SlideTextBox[] | null
  screen_desc: string | null
  image_nums: string | null
  narration: string | null
}

interface RawShape {
  text: string
  x: number
  y: number
  w: number
  h: number
  fontSize?: number
}

const MENU_SECTION_LABELS = new Set([
  '학습열기',
  '학습목표',
  '학습내용',
  '문제풀기',
  '적용하기',
  '핵심 쏙!쏙! 편집 스킬 UP',
  '학습내용1',
  '학습내용2',
  '참고자료',
])

function elementsByLocalName(root: Element, localName: string): Element[] {
  const result: Element[] = []
  const walk = (node: Element) => {
    if (node.localName === localName) result.push(node)
    for (const child of Array.from(node.children)) {
      if (child instanceof Element) walk(child)
    }
  }
  walk(root)
  return result
}

function firstChildByLocalName(parent: Element, localName: string): Element | null {
  for (const child of Array.from(parent.children)) {
    if (child instanceof Element) {
      if (child.localName === localName) return child
      const found = firstChildByLocalName(child, localName)
      if (found) return found
    }
  }
  return null
}

function attrInt(el: Element | null, localName: string): number {
  if (!el) return 0
  const val = el.getAttribute(localName) ?? el.getAttribute(`a:${localName}`)
  return val ? parseInt(val, 10) : 0
}

function extractParagraphText(p: Element): string {
  const runs = elementsByLocalName(p, 't')
  return runs.map((t) => t.textContent ?? '').join('')
}

function extractBodyText(txBody: Element): string {
  const paragraphs = elementsByLocalName(txBody, 'p')
  if (paragraphs.length === 0) return ''

  return paragraphs
    .map((p) => extractParagraphText(p))
    .join('\n')
    .trim()
}

function extractFontSize(txBody: Element): number | undefined {
  const sz = firstChildByLocalName(txBody, 'sz')
  if (!sz) return undefined
  const val = sz.getAttribute('val')
  return val ? parseInt(val, 10) / 100 : undefined
}

function getShapeXfrm(shape: Element): Element | null {
  return (
    firstChildByLocalName(shape, 'xfrm') ??
    (() => {
      const spPr = firstChildByLocalName(shape, 'spPr')
      if (spPr) return firstChildByLocalName(spPr, 'xfrm')
      const grpSpPr = firstChildByLocalName(shape, 'grpSpPr')
      return grpSpPr ? firstChildByLocalName(grpSpPr, 'xfrm') : null
    })()
  )
}

function getShapeTransform(shape: Element): { x: number; y: number; w: number; h: number } {
  const xfrm = getShapeXfrm(shape)
  const off = xfrm ? firstChildByLocalName(xfrm, 'off') : null
  const ext = xfrm ? firstChildByLocalName(xfrm, 'ext') : null

  return {
    x: attrInt(off, 'x'),
    y: attrInt(off, 'y'),
    w: attrInt(ext, 'cx'),
    h: attrInt(ext, 'cy'),
  }
}

/** grpSp 자식 좌표계 → 슬라이드 EMU 변환 컨텍스트 */
interface CoordCtx {
  originX: number
  originY: number
  scaleX: number
  scaleY: number
}

const ROOT_CTX: CoordCtx = { originX: 0, originY: 0, scaleX: 1, scaleY: 1 }

function groupChildCtx(grp: Element, parent: CoordCtx): CoordCtx {
  const { x, y, w, h } = getShapeTransform(grp)
  const xfrm = getShapeXfrm(grp)
  const chOff = xfrm ? firstChildByLocalName(xfrm, 'chOff') : null
  const chExt = xfrm ? firstChildByLocalName(xfrm, 'chExt') : null
  const chOffX = attrInt(chOff, 'x')
  const chOffY = attrInt(chOff, 'y')
  const chExtW = attrInt(chExt, 'cx') || w || 1
  const chExtH = attrInt(chExt, 'cy') || h || 1
  const gScaleX = w / chExtW
  const gScaleY = h / chExtH

  return {
    originX: parent.originX + parent.scaleX * (x - chOffX * gScaleX),
    originY: parent.originY + parent.scaleY * (y - chOffY * gScaleY),
    scaleX: parent.scaleX * gScaleX,
    scaleY: parent.scaleY * gScaleY,
  }
}

function toSlideCoords(
  localX: number,
  localY: number,
  localW: number,
  localH: number,
  ctx: CoordCtx,
): { x: number; y: number; w: number; h: number } {
  return {
    x: ctx.originX + ctx.scaleX * localX,
    y: ctx.originY + ctx.scaleY * localY,
    w: localW * ctx.scaleX,
    h: localH * ctx.scaleY,
  }
}

function pushTextShape(
  shapes: RawShape[],
  shape: Element,
  ctx: CoordCtx,
): void {
  const txBody = firstChildByLocalName(shape, 'txBody')
  if (!txBody) return

  const text = extractBodyText(txBody)
  if (!text) return

  const local = getShapeTransform(shape)
  const abs = toSlideCoords(local.x, local.y, local.w, local.h, ctx)
  shapes.push({
    text,
    ...abs,
    fontSize: extractFontSize(txBody),
  })
}

/** grpSp chOff/chExt·중첩 그룹 변환 반영하여 spTree 하위 텍스트 도형 수집 */
function collectRawShapes(parent: Element, ctx: CoordCtx = ROOT_CTX): RawShape[] {
  const shapes: RawShape[] = []

  const walk = (node: Element, currentCtx: CoordCtx) => {
    for (const child of Array.from(node.children)) {
      if (!(child instanceof Element)) continue

      if (child.localName === 'sp' || child.localName === 'cxnSp') {
        pushTextShape(shapes, child, currentCtx)
      } else if (child.localName === 'grpSp') {
        walk(child, groupChildCtx(child, currentCtx))
      } else if (child.localName === 'graphicFrame') {
        const table = firstChildByLocalName(child, 'tbl')
        if (!table) {
          walk(child, currentCtx)
          continue
        }

        const local = getShapeTransform(child)
        const abs = toSlideCoords(local.x, local.y, local.w, local.h, currentCtx)

        for (const tc of elementsByLocalName(table, 'tc')) {
          const txBody = firstChildByLocalName(tc, 'txBody')
          if (!txBody) continue
          const text = extractBodyText(txBody)
          if (!text) continue
          shapes.push({ text, ...abs })
        }
      } else {
        walk(child, currentCtx)
      }
    }
  }

  walk(parent, ctx)
  return shapes
}

function extractShapes(spTree: Element): RawShape[] {
  return collectRawShapes(spTree)
}

function isScreenNum(x: number, y: number, w: number, _h: number): boolean {
  return x / SB_CX > 0.79 && y / SB_CY < 0.12 && w / SB_CX < 0.2
}

function isCourseName(x: number, y: number, _w: number, _h: number): boolean {
  return x / SB_CX > 0.1 && x / SB_CX < 0.5 && y / SB_CY >= 0.04 && y / SB_CY < 0.08
}

function isChapterName(x: number, y: number, _w: number, _h: number): boolean {
  return x / SB_CX > 0.1 && x / SB_CX < 0.35 && y / SB_CY >= 0.08 && y / SB_CY < 0.15
}

/** 좌측 목차: 박스 전체가 좌측 25% 안에 있을 때만 (왼쪽 끝만 닿으면 화면 텍스트로 인정) */
function isMenu(x: number, y: number, w: number, h: number): boolean {
  const xRight = (x + w) / SB_CX
  const yBottom = (y + h) / SB_CY
  return xRight <= 0.25 && y / SB_CY >= 0.08 && yBottom <= 0.78
}

/** 중앙 화면 영역과 겹치는 박스 (크기 0이면 중심점으로 판별) */
function overlapsScreenContent(x: number, y: number, w: number, h: number): boolean {
  if (w <= 0 && h <= 0) {
    const cx = x / SB_CX
    const cy = y / SB_CY
    return cx > 0.13 && cx < 0.75 && cy > 0.08 && cy < 0.78
  }

  const xR = x / SB_CX
  const xRight = (x + Math.max(w, 0)) / SB_CX
  const yR = y / SB_CY
  const yBottom = (y + Math.max(h, 0)) / SB_CY
  if (xRight > 0.13 && xR < 0.75 && yBottom > 0.08 && yR < 0.78) return true

  const cx = (x + w / 2) / SB_CX
  const cy = (y + h / 2) / SB_CY
  return cx > 0.13 && cx < 0.75 && cy > 0.08 && cy < 0.78
}

function isScreen(x: number, y: number, w: number, h: number): boolean {
  return overlapsScreenContent(x, y, w, h)
}

function isScreenDesc(x: number, y: number, _w: number, _h: number): boolean {
  return x / SB_CX >= 0.75 && y / SB_CY < 0.63
}

function isImageNum(x: number, y: number, _w: number, _h: number): boolean {
  return x / SB_CX >= 0.75 && y / SB_CY >= 0.63 && y / SB_CY < 0.78
}

function isNarration(x: number, y: number, _w: number, _h: number): boolean {
  const xR = x / SB_CX
  const yR = y / SB_CY
  if (yR >= 0.78) return true
  return yR >= 0.74 && yR < 0.86 && xR < 0.15
}

/** 제작 지시(애니메이션/연출) 문구 — 나레이션 본문이 아님 */
function isDirectorNote(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  if (/^jv\d/i.test(t) || /^[\d,\sjv]+$/i.test(t)) return true
  if (/사운드\s*스트리밍|스트리밍\s*동안/i.test(t)) return true
  if (/다이어그램\s*전체\s*제시/i.test(t)) return true
  if (/텍스트.*이미지.*제시|이미지.*텍스트.*제시/i.test(t)) return true
  if (/강조효과|화살표.*함께|연결선.*함께/i.test(t)) return true
  if (/차례로\s*제시|행별\s*내용\s*차례로/i.test(t)) return true
  if (/영역\s*구분선\s*함께/i.test(t)) return true
  if (t.length < 80 && /제시/.test(t) && !/PLC|제어|학습|산업|현대|생산|피드백|시퀀스/.test(t)) {
    return true
  }
  return false
}

function isNarrationCandidate(text: string): boolean {
  const t = text.trim()
  if (!/^#\d/.test(t)) return false
  if (t.length < 40) return false
  return !isDirectorNote(t)
}

/** 좌표가 (0,0)인 나레이션 박스 — 위치 기반 분류 실패 시 텍스트 패턴으로 보완 */
function findFallbackNarration(shapes: RawShape[]): string | null {
  const candidates = shapes.filter(
    (s) =>
      isNarrationCandidate(s.text) &&
      !isScreen(s.x, s.y, s.w, s.h) &&
      !isScreenDesc(s.x, s.y, s.w, s.h) &&
      !isMenu(s.x, s.y, s.w, s.h),
  )
  if (candidates.length === 0) return null

  const atOrigin = candidates.filter((s) => s.x === 0 && s.y === 0)
  const pool = atOrigin.length > 0 ? atOrigin : candidates

  return (
    pool
      .slice()
      .sort((a, b) => b.text.length - a.text.length)[0]
      ?.text.trim() || null
  )
}

function classifySlideType(shapes: RawShape[], slideNum: number): SlideType {
  const topTxt = shapes
    .filter((s) => isScreenNum(s.x, s.y, s.w, s.h))
    .map((s) => s.text)
    .join(' ')

  const anyTxt = shapes.map((s) => s.text).join(' ')

  if (slideNum <= 9) return 'guide'
  if (topTxt.includes('간지') || anyTxt.includes('간지')) return 'divider'
  if (topTxt.includes('INTRO') || /\d{2}_01\b/.test(topTxt)) return 'intro'
  if (topTxt.includes('OUTRO') || topTxt.includes('아웃트로')) return 'outro'
  if (topTxt.includes('적용하기')) return 'apply'
  if (topTxt.includes('문제풀기')) return 'quiz'
  if (/\d{2}_\d{2}/.test(topTxt)) return 'lesson'
  return 'content'
}

/** 나레이션·화면 싱크용 마커 (#1, #2 …) — 화면 텍스트 추출 시 제외 */
export function isSyncMarkerOnly(text: string): boolean {
  return /^#\d+\s*$/.test(text.trim())
}

function isScreenTextExcluded(s: RawShape): boolean {
  const firstLine = s.text.split('\n')[0]?.trim() ?? ''
  return (
    isSyncMarkerOnly(s.text) ||
    isMenu(s.x, s.y, s.w, s.h) ||
    isNarration(s.x, s.y, s.w, s.h) ||
    isScreenDesc(s.x, s.y, s.w, s.h) ||
    isScreenNum(s.x, s.y, s.w, s.h) ||
    isCourseName(s.x, s.y, s.w, s.h) ||
    isChapterName(s.x, s.y, s.w, s.h) ||
    isImageNum(s.x, s.y, s.w, s.h) ||
    isDirectorNote(s.text) ||
    MENU_SECTION_LABELS.has(firstLine) ||
    /^출처\s*:/.test(s.text.trim())
  )
}

function rawShapeToBox(s: RawShape, index: number): SlideTextBox {
  return {
    id: String(index),
    text: s.text,
    x: s.x,
    y: s.y,
    w: s.w,
    h: s.h,
    font_size: s.fontSize,
  }
}

/** 화면 세로 밴드(8%~78%) 안인지 — 높이 0이면 상단 y 기준 */
function isInScreenVerticalBand(y: number, h: number): boolean {
  const mid = h > 0 ? (y + h / 2) / SB_CY : y / SB_CY
  return mid >= 0.08 && mid < 0.78
}

/** 좌표 분류 실패 시 화면 세로 밴드 안의 비-UI 텍스트 보완 */
function findFallbackScreenText(shapes: RawShape[]): SlideTextBox[] {
  return shapes
    .filter((s) => {
      if (!s.text.trim() || isScreenTextExcluded(s)) return false
      if (overlapsScreenContent(s.x, s.y, s.w, s.h) && !isMenu(s.x, s.y, s.w, s.h)) {
        return true
      }
      if (!isInScreenVerticalBand(s.y, s.h) || isMenu(s.x, s.y, s.w, s.h)) return false
      const xStart = s.x / SB_CX
      const xEnd = (s.x + Math.max(s.w, SB_CX * 0.02)) / SB_CX
      return xEnd > 0.10 && xStart < 0.80
    })
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map(rawShapeToBox)
}

function toScreenBoxes(shapes: RawShape[]): SlideTextBox[] {
  const primary = shapes
    .filter(
      (s) =>
        overlapsScreenContent(s.x, s.y, s.w, s.h) && !isScreenTextExcluded(s),
    )
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map(rawShapeToBox)

  if (primary.length > 0) return primary
  return findFallbackScreenText(shapes)
}

function findSpTree(root: Element): Element | null {
  const cSld = firstChildByLocalName(root, 'cSld')
  if (cSld) return firstChildByLocalName(cSld, 'spTree')
  return firstChildByLocalName(root, 'spTree')
}

function parseSlideXml(xml: string, slideNum: number): ParsedSlide | null {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const spTree = findSpTree(doc.documentElement)
  const shapes = spTree ? extractShapes(spTree) : []

  const slideType = classifySlideType(shapes, slideNum)
  if (slideType === 'guide') return null

  const snShapes = shapes.filter((s) => isScreenNum(s.x, s.y, s.w, s.h))
  const cnShapes = shapes.filter((s) => isCourseName(s.x, s.y, s.w, s.h))
  const chShapes = shapes.filter((s) => isChapterName(s.x, s.y, s.w, s.h))
  const descShapes = shapes.filter((s) => isScreenDesc(s.x, s.y, s.w, s.h))
  const imgShapes = shapes.filter((s) => isImageNum(s.x, s.y, s.w, s.h))
  const narShapes = shapes.filter((s) => isNarration(s.x, s.y, s.w, s.h))

  const screenNum =
    snShapes
      .filter(
        (s) =>
          s.text.length < 15 && !s.text.includes('페이지') && !s.text.includes(')'),
      )
      .map((s) => s.text)
      .join(' ')
      .trim() || null

  const screenDesc =
    descShapes
      .filter(
        (s) => s.text !== '-' && !/^\d{2}_\d{2}$/.test(s.text) && s.y / SB_CY < 0.63,
      )
      .map((s) => s.text)
      .join('\n')
      .trim() || null

  const imageNums =
    imgShapes
      .filter((s) => s.text !== '-')
      .map((s) => s.text)
      .join(', ')
      .trim() || null

  const screenBoxes = toScreenBoxes(shapes)

  const narration =
    narShapes
      .map((s) => s.text)
      .join('\n')
      .trim() ||
    findFallbackNarration(shapes) ||
    null

  const courseName =
    cnShapes
      .map((s) => s.text.split('\n')[0] ?? '')
      .join(' ')
      .trim() || null

  const chapterName =
    chShapes
      .filter((s) => !cnShapes.includes(s))
      .map((s) => s.text.split('\n')[0] ?? '')
      .join(' ')
      .trim() || null

  return {
    slide_num: slideNum,
    slide_type: slideType,
    screen_num: screenNum,
    course_name: courseName,
    chapter_name: chapterName,
    current_section: null,
    screen_text: screenBoxes.length > 0 ? screenBoxes : null,
    screen_desc: screenDesc,
    image_nums: imageNums,
    narration,
  }
}

function sortSlidePaths(paths: string[]): string[] {
  return paths.sort((a, b) => {
    const numA = parseInt(a.match(/slide(\d+)\.xml/)?.[1] ?? '0', 10)
    const numB = parseInt(b.match(/slide(\d+)\.xml/)?.[1] ?? '0', 10)
    return numA - numB
  })
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

export interface ParseProgress {
  current: number
  total: number
  phase: 'parsing' | 'saving'
}

export async function parsePptx(
  data: ArrayBuffer | Blob,
  onProgress?: (progress: ParseProgress) => void,
): Promise<ParsedSlide[]> {
  const zip = await JSZip.loadAsync(data)
  const slidePaths = sortSlidePaths(
    Object.keys(zip.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path)),
  )

  const slides: ParsedSlide[] = []
  const total = slidePaths.length

  for (let i = 0; i < slidePaths.length; i++) {
    const slideNum = i + 1
    const xml = await zip.file(slidePaths[i])!.async('string')
    const parsed = parseSlideXml(xml, slideNum)
    if (parsed) slides.push(parsed)

    onProgress?.({ current: i + 1, total, phase: 'parsing' })

    if (i % 3 === 2) {
      await yieldToMainThread()
    }
  }

  return slides
}

export const SLIDE_TYPE_LABELS: Record<SlideType, string> = {
  guide: '가이드',
  intro: '인트로',
  divider: '간지',
  outro: '아웃트로',
  quiz: '문제풀기',
  apply: '적용하기',
  lesson: '레슨',
  content: '콘텐츠',
}

export function normalizeScreenText(raw: SlideTextBox[] | string | null | unknown): SlideTextBox[] | null {
  if (raw == null) return null

  if (Array.isArray(raw)) {
    return raw.length > 0 ? (raw as SlideTextBox[]) : null
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed || trimmed === 'null') return null

    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        if (Array.isArray(parsed)) {
          return parsed.length > 0 ? (parsed as SlideTextBox[]) : null
        }
      } catch {
        // plain text fallback
      }
    }

    return [{ id: '0', text: trimmed, x: 0, y: 0, w: 0, h: 0 }]
  }

  return null
}

export function formatScreenText(boxes: SlideTextBox[] | string | null | unknown): string {
  const normalized = normalizeScreenText(boxes)
  if (!normalized?.length) return ''

  return normalized
    .map((box) => (typeof box === 'object' && box && 'text' in box ? String(box.text ?? '') : ''))
    .filter(Boolean)
    .join('\n')
}

export function parseScreenTextInput(
  value: string,
  existing: SlideTextBox[] | string | null,
): SlideTextBox[] | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const normalizedExisting = normalizeScreenText(existing)

  if (normalizedExisting?.length) {
    const [first, ...rest] = normalizedExisting
    return [
      { ...first, text: trimmed },
      ...rest.map((box) => ({ ...box, text: '' })),
    ]
  }

  return [{ id: '0', text: trimmed, x: 0, y: 0, w: 0, h: 0 }]
}
