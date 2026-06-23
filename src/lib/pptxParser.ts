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

/** HTML extractShapes와 동일: spTree 하위 모든 sp를 개별 좌표로 수집 */
function extractShapes(spTree: Element): RawShape[] {
  const shapes: RawShape[] = []

  for (const sp of elementsByLocalName(spTree, 'sp')) {
    const txBody = firstChildByLocalName(sp, 'txBody')
    if (!txBody) continue

    const text = extractBodyText(txBody)
    if (!text) continue

    let x = 0
    let y = 0
    let w = 0
    let h = 0

    const xfrm = firstChildByLocalName(sp, 'xfrm')
    if (xfrm) {
      const off = firstChildByLocalName(xfrm, 'off')
      const ext = firstChildByLocalName(xfrm, 'ext')
      if (off && ext) {
        x = attrInt(off, 'x')
        y = attrInt(off, 'y')
        w = attrInt(ext, 'cx')
        h = attrInt(ext, 'cy')
      }
    }

    shapes.push({
      text,
      x,
      y,
      w,
      h,
      fontSize: extractFontSize(txBody),
    })
  }

  for (const frame of elementsByLocalName(spTree, 'graphicFrame')) {
    const table = firstChildByLocalName(frame, 'tbl')
    if (!table) continue

    const { x, y, w, h } = (() => {
      const xfrm = firstChildByLocalName(frame, 'xfrm')
      const off = xfrm ? firstChildByLocalName(xfrm, 'off') : null
      const ext = xfrm ? firstChildByLocalName(xfrm, 'ext') : null
      return {
        x: attrInt(off, 'x'),
        y: attrInt(off, 'y'),
        w: attrInt(ext, 'cx'),
        h: attrInt(ext, 'cy'),
      }
    })()

    for (const tc of elementsByLocalName(table, 'tc')) {
      const txBody = firstChildByLocalName(tc, 'txBody')
      if (!txBody) continue
      const text = extractBodyText(txBody)
      if (!text) continue
      shapes.push({ text, x, y, w, h })
    }
  }

  return shapes
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

function isMenu(x: number, y: number, _w: number, _h: number): boolean {
  return x / SB_CX < 0.25 && y / SB_CY >= 0.08 && y / SB_CY < 0.78
}

function isScreen(x: number, y: number, _w: number, _h: number): boolean {
  return x / SB_CX >= 0.13 && x / SB_CX < 0.75 && y / SB_CY >= 0.08 && y / SB_CY < 0.78
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

function pickCurrentSection(menuShapes: RawShape[]): string | null {
  const menuTexts = menuShapes.map((s) => s.text.split('\n')[0]?.trim() ?? '').filter(Boolean)
  if (menuTexts.length === 0) return null

  const picked =
    menuTexts.find((t) => t.startsWith('▶')) ??
    menuTexts.find((t) => !MENU_SECTION_LABELS.has(t)) ??
    menuTexts[0]

  return picked.replace(/^▶\s*/, '').trim() || null
}

function toScreenBoxes(shapes: RawShape[]): SlideTextBox[] {
  const menuShapes = shapes.filter((s) => isMenu(s.x, s.y, s.w, s.h))
  const menuSet = new Set(menuShapes)

  return shapes
    .filter((s) => isScreen(s.x, s.y, s.w, s.h) && !menuSet.has(s))
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((s, index) => ({
      id: String(index),
      text: s.text,
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
      font_size: s.fontSize,
    }))
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
  const menuShapes = shapes.filter((s) => isMenu(s.x, s.y, s.w, s.h))
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
    current_section: pickCurrentSection(menuShapes),
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
