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

type RegionKey =
  | 'screen_num'
  | 'course_name'
  | 'chapter_name'
  | 'menu'
  | 'screen'
  | 'screen_desc'
  | 'image_num'
  | 'narration'

interface RawTextBox {
  text: string
  x: number
  y: number
  w: number
  h: number
  fontSize?: number
}

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

function getShapeTransform(shape: Element): { x: number; y: number; w: number; h: number } {
  const xfrm =
    firstChildByLocalName(shape, 'xfrm') ??
    (() => {
      const spPr = firstChildByLocalName(shape, 'spPr')
      return spPr ? firstChildByLocalName(spPr, 'xfrm') : null
    })()

  const off = xfrm ? firstChildByLocalName(xfrm, 'off') : null
  const ext = xfrm ? firstChildByLocalName(xfrm, 'ext') : null

  return {
    x: attrInt(off, 'x'),
    y: attrInt(off, 'y'),
    w: attrInt(ext, 'cx'),
    h: attrInt(ext, 'cy'),
  }
}

function extractTextBoxes(
  parent: Element,
  offsetX = 0,
  offsetY = 0,
): RawTextBox[] {
  const boxes: RawTextBox[] = []

  for (const child of Array.from(parent.children)) {
    if (!(child instanceof Element)) continue

    const tag = child.localName

    if (tag === 'sp') {
      const txBody = firstChildByLocalName(child, 'txBody')
      if (!txBody) continue

      const text = extractBodyText(txBody)
      if (!text) continue

      const { x, y, w, h } = getShapeTransform(child)
      boxes.push({
        text,
        x: x + offsetX,
        y: y + offsetY,
        w,
        h,
        fontSize: extractFontSize(txBody),
      })
    } else if (tag === 'grpSp') {
      const { x, y } = getShapeTransform(child)
      boxes.push(...extractTextBoxes(child, offsetX + x, offsetY + y))
    }
  }

  return boxes
}

function classifyRegion(x: number, y: number, w: number, _h: number): RegionKey | null {
  const xR = x / SB_CX
  const yR = y / SB_CY
  const wR = w / SB_CX

  if (xR > 0.79 && yR < 0.12 && wR < 0.2) return 'screen_num'
  if (xR > 0.1 && xR < 0.5 && yR >= 0.04 && yR < 0.08) return 'course_name'
  if (xR > 0.1 && xR < 0.35 && yR >= 0.08 && yR < 0.15) return 'chapter_name'
  if (yR >= 0.78) return 'narration'
  if (xR >= 0.75 && yR >= 0.63 && yR < 0.78) return 'image_num'
  if (xR >= 0.75 && yR < 0.63) return 'screen_desc'
  if (xR < 0.25 && yR >= 0.08 && yR < 0.78) return 'menu'
  if (xR >= 0.13 && xR < 0.75 && yR >= 0.08 && yR < 0.78) return 'screen'
  return null
}

function appendRegionText(map: Map<RegionKey, string[]>, key: RegionKey, text: string) {
  const list = map.get(key) ?? []
  list.push(text)
  map.set(key, list)
}

function joinRegion(map: Map<RegionKey, string[]>, key: RegionKey): string | null {
  const texts = map.get(key)
  if (!texts?.length) return null
  return texts.join('\n').trim() || null
}

function classifySlideType(
  slideNum: number,
  screenNum: string | null,
  allText: string,
): SlideType {
  if (slideNum <= 9) return 'guide'

  const sn = (screenNum ?? '').toUpperCase()
  const combined = `${sn} ${allText}`

  if (sn.includes('INTRO') || /^0?1(?:[_\s-]|$)/.test(sn)) return 'intro'
  if (combined.includes('간지')) return 'divider'
  if (sn.includes('OUTRO') || combined.includes('아웃트로')) return 'outro'
  if (combined.includes('문제풀기')) return 'quiz'
  if (combined.includes('적용하기')) return 'apply'
  if (/\d{2}_\d{2}/.test(sn)) return 'lesson'
  return 'content'
}

function findSpTree(root: Element): Element | null {
  const cSld = firstChildByLocalName(root, 'cSld')
  if (cSld) return firstChildByLocalName(cSld, 'spTree')
  return firstChildByLocalName(root, 'spTree')
}

function parseSlideXml(xml: string, slideNum: number): ParsedSlide | null {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const root = doc.documentElement
  const spTree = findSpTree(root)
  const rawBoxes = spTree ? extractTextBoxes(spTree) : []

  const regionMap = new Map<RegionKey, string[]>()
  const screenBoxes: SlideTextBox[] = []

  rawBoxes.forEach((box, index) => {
    const region = classifyRegion(box.x, box.y, box.w, box.h)

    if (region === 'screen') {
      screenBoxes.push({
        id: String(index),
        text: box.text,
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        font_size: box.fontSize,
      })
    } else if (region) {
      appendRegionText(regionMap, region, box.text)
    }
  })

  screenBoxes.sort((a, b) => a.y - b.y || a.x - b.x)

  const screenNum = joinRegion(regionMap, 'screen_num')
  const allText = rawBoxes.map((b) => b.text).join(' ')
  const slideType = classifySlideType(slideNum, screenNum, allText)

  if (slideType === 'guide') return null

  return {
    slide_num: slideNum,
    slide_type: slideType,
    screen_num: screenNum,
    course_name: joinRegion(regionMap, 'course_name'),
    chapter_name: joinRegion(regionMap, 'chapter_name'),
    current_section: joinRegion(regionMap, 'menu'),
    screen_text: screenBoxes.length > 0 ? screenBoxes : null,
    screen_desc: joinRegion(regionMap, 'screen_desc'),
    image_nums: joinRegion(regionMap, 'image_num'),
    narration: joinRegion(regionMap, 'narration'),
  }
}

function sortSlidePaths(paths: string[]): string[] {
  return paths.sort((a, b) => {
    const numA = parseInt(a.match(/slide(\d+)\.xml/)?.[1] ?? '0', 10)
    const numB = parseInt(b.match(/slide(\d+)\.xml/)?.[1] ?? '0', 10)
    return numA - numB
  })
}

export async function parsePptx(data: ArrayBuffer | Blob): Promise<ParsedSlide[]> {
  const zip = await JSZip.loadAsync(data)
  const slidePaths = sortSlidePaths(
    Object.keys(zip.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path)),
  )

  const slides: ParsedSlide[] = []

  for (let i = 0; i < slidePaths.length; i++) {
    const slideNum = i + 1
    const xml = await zip.file(slidePaths[i])!.async('string')
    const parsed = parseSlideXml(xml, slideNum)
    if (parsed) slides.push(parsed)
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

export function formatScreenText(boxes: SlideTextBox[] | null): string {
  if (!boxes?.length) return ''
  return boxes.map((b) => b.text).join('\n')
}

export function parseScreenTextInput(
  value: string,
  existing: SlideTextBox[] | null,
): SlideTextBox[] | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  if (existing?.length) {
    const [first, ...rest] = existing
    return [
      { ...first, text: trimmed },
      ...rest.map((box) => ({ ...box, text: '' })),
    ]
  }

  return [{ id: '0', text: trimmed, x: 0, y: 0, w: 0, h: 0 }]
}
