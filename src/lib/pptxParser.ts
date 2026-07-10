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
  narration: SlideTextBox[] | null
}

interface RawShape {
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

/** 단락 내 텍스트 run·줄바꿈(<a:br/>) 순서를 유지해 추출 */
function extractParagraphText(p: Element): string {
  const parts: string[] = []

  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (!(child instanceof Element)) continue
      if (child.localName === 't') {
        parts.push(child.textContent ?? '')
      } else if (child.localName === 'br') {
        parts.push('\n')
      } else if (
        child.localName === 'r' ||
        child.localName === 'fld' ||
        child.localName === 'hyperlink'
      ) {
        walk(child)
      }
    }
  }

  walk(p)
  return parts.join('')
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
  for (const sz of elementsByLocalName(txBody, 'sz')) {
    const val = sz.getAttribute('val')
    if (val) return parseInt(val, 10) / 100
  }
  return undefined
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

interface PptxBundle {
  zip: JSZip
  partShapesCache: Map<string, RawShape[]>
}

function findRelationshipTarget(relsXml: string, partName: string): string | null {
  const doc = new DOMParser().parseFromString(relsXml, 'application/xml')
  for (const rel of elementsByLocalName(doc.documentElement, 'Relationship')) {
    const type = rel.getAttribute('Type') ?? ''
    if (type.includes(partName)) {
      return rel.getAttribute('Target')
    }
  }
  return null
}

function resolvePartPath(relsFilePath: string, target: string): string {
  const dir = relsFilePath.replace(/\/_rels\/[^/]+$/, '')
  const parts = dir.split('/').filter(Boolean)
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

async function loadShapesFromPart(bundle: PptxBundle, partPath: string): Promise<RawShape[]> {
  const cached = bundle.partShapesCache.get(partPath)
  if (cached) return cached

  const file = bundle.zip.file(partPath)
  if (!file) {
    bundle.partShapesCache.set(partPath, [])
    return []
  }

  const xml = await file.async('string')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const spTree = findSpTree(doc.documentElement)
  const shapes = spTree ? extractShapes(spTree) : []
  bundle.partShapesCache.set(partPath, shapes)
  return shapes
}

/** 마스터 → 레이아웃 → 슬라이드 순 병합 (슬라이드가 동일 위치를 덮어쓰면 마스터/레이아웃 제외) */
function mergeInheritedShapes(...layers: RawShape[][]): RawShape[] {
  const master = layers[0] ?? []
  const layout = layers[1] ?? []
  const slide = layers[2] ?? []

  const slidePosKeys = new Set(
    slide.map((s) => `${Math.round(s.x / 40_000)}:${Math.round(s.y / 40_000)}`),
  )

  const inherited = [...master, ...layout].filter((s) => {
    const key = `${Math.round(s.x / 40_000)}:${Math.round(s.y / 40_000)}`
    return !slidePosKeys.has(key)
  })

  return [...inherited, ...slide]
}

async function getMergedShapesForSlide(
  bundle: PptxBundle,
  slideNum: number,
): Promise<{ contentShapes: RawShape[]; screenNumShapes: RawShape[] }> {
  const slidePath = `ppt/slides/slide${slideNum}.xml`
  const slideRelsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`

  const slideShapes = await loadShapesFromPart(bundle, slidePath)
  let layoutShapes: RawShape[] = []
  let masterShapes: RawShape[] = []

  const slideRelsFile = bundle.zip.file(slideRelsPath)
  if (slideRelsFile) {
    const slideRelsXml = await slideRelsFile.async('string')
    const layoutTarget = findRelationshipTarget(slideRelsXml, 'slideLayout')
    if (layoutTarget) {
      const layoutPath = resolvePartPath(slideRelsPath, layoutTarget)
      layoutShapes = await loadShapesFromPart(bundle, layoutPath)

      const layoutName = layoutPath.split('/').pop()!
      const layoutRelsPath = `ppt/slideLayouts/_rels/${layoutName}.rels`
      const layoutRelsFile = bundle.zip.file(layoutRelsPath)
      if (layoutRelsFile) {
        const layoutRelsXml = await layoutRelsFile.async('string')
        const masterTarget = findRelationshipTarget(layoutRelsXml, 'slideMaster')
        if (masterTarget) {
          const masterPath = resolvePartPath(layoutRelsPath, masterTarget)
          masterShapes = await loadShapesFromPart(bundle, masterPath)
        }
      }
    }
  }

  return {
    // 번역·화면/나레이션 추출: 레이아웃+슬라이드만 (마스터 라벨 제외)
    contentShapes: mergeInheritedShapes([], layoutShapes, slideShapes),
    // 화면번호: 마스터+레이아웃+슬라이드 (상단 화면번호 영역)
    screenNumShapes: mergeInheritedShapes(masterShapes, layoutShapes, slideShapes),
  }
}

async function createPptxBundle(data: ArrayBuffer | Blob): Promise<PptxBundle> {
  const zip = await JSZip.loadAsync(data)
  return { zip, partShapesCache: new Map() }
}

function isScreenNum(x: number, y: number, w: number, h: number): boolean {
  return overlapsRegionAtThreshold(x, y, w, h, SCREEN_NUM_REGION)
}

function isScreenNumPartText(text: string): boolean {
  const t = text.trim()
  if (!t || t === '화면번호') return false
  if (/^\d{2}[-_]\d{2}$/.test(t)) return true
  return /^[\d_\-]+$/.test(t) || /^\d{1,2}$/.test(t) || /^\d{2}[-_]?$/.test(t)
}

/** 화면번호 패턴 (01-00, 01_00 등) — 화면텍스트가 아닌 screen_num 필드용 */
export function isScreenNumText(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (/^\d{2}[-_]\d{2}$/.test(t)) return true
  return isScreenNumPartText(t) && t.length <= 8
}

function buildScreenNum(shapes: RawShape[]): string | null {
  const parts = shapes
    .filter((s) => overlapsRegionAtThreshold(s.x, s.y, s.w, s.h, SCREEN_NUM_REGION))
    .filter((s) => isScreenNumPartText(s.text))
    .sort((a, b) => a.x - b.x)

  if (parts.length === 0) {
    const inline = shapes.find((s) => isScreenNumText(s.text))
    if (inline) return inline.text.trim().replace(/_/g, '-')
    return null
  }

  const normalized = parts.map((s) => s.text.trim().replace(/_+$/, '-').replace(/_/g, '-'))
  if (normalized.length >= 2) {
    const prefix = normalized[0].replace(/-$/, '')
    const suffix = normalized[normalized.length - 1]
    if (/^\d{1,2}$/.test(suffix)) {
      return `${prefix}-${suffix}`
    }
  }

  const joined = normalized.join('').replace(/(\d{2})-?(\d{1,2})$/, '$1-$2')
  return joined || null
}

function isCourseName(x: number, y: number, _w: number, _h: number): boolean {
  return x / SB_CX > 0.1 && x / SB_CX < 0.5 && y / SB_CY >= 0.04 && y / SB_CY < 0.08
}

function isChapterName(x: number, y: number, _w: number, _h: number): boolean {
  return x / SB_CX > 0.1 && x / SB_CX < 0.35 && y / SB_CY >= 0.08 && y / SB_CY < 0.15
}

/** 좌측 목차: 박스 전체가 좌측 25% 안에 있을 때만 */
function isMenu(x: number, y: number, w: number, h: number): boolean {
  const xRight = (x + w) / SB_CX
  const yBottom = (y + h) / SB_CY
  return xRight <= 0.25 && y / SB_CY >= 0.08 && yBottom <= 0.78
}

const SCREEN_REGION = {
  left: 0.13 * SB_CX,
  top: 0.08 * SB_CY,
  right: 0.75 * SB_CX,
  bottom: 0.78 * SB_CY,
}

const SCREEN_DESC_REGION = {
  left: 0.58 * SB_CX,
  top: 0.08 * SB_CY,
  right: SB_CX,
  bottom: 0.63 * SB_CY,
}

const NARRATION_SCRIPT_REGION = {
  left: 0,
  top: 0.54 * SB_CY,
  right: SB_CX,
  bottom: 0.74 * SB_CY,
}

const IMAGE_NUM_REGION = {
  left: 0.58 * SB_CX,
  top: 0.63 * SB_CY,
  right: SB_CX,
  bottom: 0.78 * SB_CY,
}

const NARRATION_BOTTOM_REGION = {
  left: 0,
  top: 0.74 * SB_CY,
  right: SB_CX,
  bottom: SB_CY,
}

const SCREEN_NUM_REGION = {
  left: 0.6 * SB_CX,
  top: 0,
  right: 0.82 * SB_CX,
  bottom: 0.12 * SB_CY,
}

const REGION_THRESHOLD = 0.51

const HEADER_REGION = {
  left: 0,
  top: 0,
  right: SB_CX,
  bottom: 0.15 * SB_CY,
}

type ShapeRegionKind = 'screen' | 'narration' | 'desc' | 'image_num' | 'header' | 'other'

function rectOverlapArea(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): number {
  const x1 = Math.max(ax, bx)
  const y1 = Math.max(ay, by)
  const x2 = Math.min(ax + aw, bx + bw)
  const y2 = Math.min(ay + ah, by + bh)
  if (x2 <= x1 || y2 <= y1) return 0
  return (x2 - x1) * (y2 - y1)
}

function shapeRegionOverlapRatio(
  x: number,
  y: number,
  w: number,
  h: number,
  region: { left: number; top: number; right: number; bottom: number },
): number {
  const boxW = Math.max(w, 1)
  const boxH = Math.max(h, 1)
  const boxArea = boxW * boxH
  const regionW = region.right - region.left
  const regionH = region.bottom - region.top
  const overlap = rectOverlapArea(x, y, boxW, boxH, region.left, region.top, regionW, regionH)
  return overlap / boxArea
}

function overlapsRegionAtThreshold(
  x: number,
  y: number,
  w: number,
  h: number,
  region: { left: number; top: number; right: number; bottom: number },
): boolean {
  return shapeRegionOverlapRatio(x, y, w, h, region) > REGION_THRESHOLD
}

function narrationOverlapRatio(x: number, y: number, w: number, h: number): number {
  return Math.max(
    shapeRegionOverlapRatio(x, y, w, h, NARRATION_SCRIPT_REGION),
    shapeRegionOverlapRatio(x, y, w, h, NARRATION_BOTTOM_REGION),
  )
}

function classifyShapeRegion(x: number, y: number, w: number, h: number): ShapeRegionKind {
  const screenR = shapeRegionOverlapRatio(x, y, w, h, SCREEN_REGION)
  const descR = shapeRegionOverlapRatio(x, y, w, h, SCREEN_DESC_REGION)
  const imgR = shapeRegionOverlapRatio(x, y, w, h, IMAGE_NUM_REGION)
  const headerR = shapeRegionOverlapRatio(x, y, w, h, HEADER_REGION)
  const narrR = narrationOverlapRatio(x, y, w, h)

  if (headerR > REGION_THRESHOLD && headerR >= screenR) return 'header'
  if (imgR > REGION_THRESHOLD) return 'image_num'
  if (descR > REGION_THRESHOLD) return 'desc'
  if (narrR > REGION_THRESHOLD && narrR >= screenR) return 'narration'
  if (screenR > REGION_THRESHOLD) return 'screen'
  return 'other'
}

/** @internal 레거시 호환 */
export function overlapsScreenContent(x: number, y: number, w: number, h: number): boolean {
  if (w <= 0 && h <= 0) {
    const cx = x / SB_CX
    const cy = y / SB_CY
    return cx > 0.13 && cx < 0.75 && cy > 0.08 && cy < 0.78
  }
  return overlapsRegionAtThreshold(x, y, w, h, SCREEN_REGION)
}

function isNarrationUILayoutLabel(s: RawShape): boolean {
  if (classifyShapeRegion(s.x, s.y, s.w, s.h) !== 'narration') return false
  const xRight = (s.x + Math.max(s.w, 1)) / SB_CX
  const boxW = Math.max(s.w, 1) / SB_CX
  return xRight <= 0.05 && boxW < 0.05
}

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

function findFallbackNarrationShape(shapes: RawShape[]): RawShape | null {
  const candidates = shapes.filter(
    (s) =>
      classifyShapeRegion(s.x, s.y, s.w, s.h) === 'narration' &&
      !isNarrationUILayoutLabel(s) &&
      !isDirectorNote(s.text) &&
      s.text.trim().length > 0,
  )
  if (candidates.length === 0) return null

  const atOrigin = candidates.filter((s) => s.x === 0 && s.y === 0)
  const pool = atOrigin.length > 0 ? atOrigin : candidates

  return (
    pool
      .slice()
      .sort((a, b) => b.text.length - a.text.length)[0] ?? null
  )
}

function referenceScreenMetrics(
  screenBoxes: SlideTextBox[],
): { w: number; h: number; font_size?: number } {
  const ref = screenBoxes.find((b) => b.w > 0 && b.h > 0) ?? screenBoxes[0]
  if (!ref) return { w: 0, h: 0 }
  return {
    w: ref.w,
    h: ref.h,
    font_size: screenBoxes.find((b) => b.font_size)?.font_size ?? ref.font_size,
  }
}

function collectNarrationBoxes(
  shapes: RawShape[],
  screenBoxes: SlideTextBox[],
): SlideTextBox[] | null {
  const ref = referenceScreenMetrics(screenBoxes)
  const parts: string[] = []
  const seen = new Set<string>()

  const addText = (raw: string) => {
    const lines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !isBareSyncMarker(line) && !isDirectorNote(line))
    for (const line of lines) {
      if (isNonTranslatableMetadata(line) || seen.has(line)) continue
      seen.add(line)
      parts.push(line)
    }
  }

  for (const s of shapes) {
    if (
      classifyShapeRegion(s.x, s.y, s.w, s.h) === 'narration' &&
      !isNarrationUILayoutLabel(s) &&
      !isNonTranslatableMetadata(s.text)
    ) {
      addText(s.text)
    }
  }

  if (parts.length === 0) {
    const fallback = findFallbackNarrationShape(shapes)
    if (fallback) addText(fallback.text)
  }

  const text = parts.join('\n').trim()
  if (!text) return null

  const screenW = ref.w > 0 ? ref.w : SB_CX * 0.4
  return [
    {
      id: '0',
      text,
      x: 0,
      y: 0,
      w: Math.round(screenW * 1.5),
      h: ref.h > 0 ? ref.h : SB_CY * 0.18,
      font_size: ref.font_size,
    },
  ]
}

/** 슬라이드 번호가 아닌 화면번호·본문 패턴으로 유형 판별 */
function classifySlideType(
  shapes: RawShape[],
  slideNum: number,
  totalSlides: number,
): SlideType {
  const topTxt = shapes
    .filter((s) => isScreenNum(s.x, s.y, s.w, s.h))
    .map((s) => s.text)
    .join(' ')

  const anyTxt = shapes.map((s) => s.text).join(' ')

  if (slideNum === 1) return 'intro'
  if (slideNum <= 3 && totalSlides > 4) return 'divider'
  if (slideNum === totalSlides && (topTxt.includes('OUTRO') || anyTxt.includes('아웃트로'))) {
    return 'outro'
  }
  if (slideNum === totalSlides && /\boutro\b/i.test(anyTxt)) {
    return 'outro'
  }
  if (topTxt.includes('간지') || anyTxt.includes('간지')) return 'divider'
  if (topTxt.includes('INTRO') || /\d{2}_01\b/.test(topTxt)) return 'intro'
  if (topTxt.includes('OUTRO') || topTxt.includes('아웃트로')) return 'outro'
  if (topTxt.includes('적용하기')) return 'apply'
  if (topTxt.includes('문제풀기')) return 'quiz'
  if (/\d{2}_\d{2}/.test(topTxt)) return 'lesson'
  return 'content'
}

export function isNonLearningLayout(slideType: SlideType): boolean {
  return slideType === 'intro' || slideType === 'divider' || slideType === 'outro'
}

/** 이미지출처·URL 등 번역 대상이 아닌 메타데이터 */
function isNonTranslatableMetadata(text: string): boolean {
  const t = text.trim()
  if (!t || t === '-') return true
  if (/^게티\s*\d+/i.test(t) || /^getty\s*\d+/i.test(t)) return true
  if (/^https?:\/\//i.test(t) || /^www\./i.test(t)) return true
  if (/^[a-z]+:\/\/\S+/i.test(t)) return true
  if (/^\d{7,}$/.test(t)) return true
  return false
}

/** 숫자 없는 싱크 마커(‹#›, <#>, # 단독) — 제외. #1, #2 등은 유지 */
export function isBareSyncMarker(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  if (/^#\d+/.test(t)) return false
  if (t === '#') return true
  if (/^[‹<]#?[›>]$/u.test(t)) return true
  if (/^‹#›$/u.test(t)) return true
  return /^<#>$/.test(t)
}

/** 화면텍스트 추출 시 #N 단독 박스 제외 */
export function isSyncMarkerOnly(text: string): boolean {
  return isBareSyncMarker(text) || /^#\d+\s*$/.test(text.trim())
}

function isLayoutChrome(s: RawShape): boolean {
  const region = classifyShapeRegion(s.x, s.y, s.w, s.h)

  return (
    region === 'header' ||
    region === 'desc' ||
    region === 'image_num' ||
    isMenu(s.x, s.y, s.w, s.h) ||
    overlapsRegionAtThreshold(s.x, s.y, s.w, s.h, SCREEN_NUM_REGION) ||
    isCourseName(s.x, s.y, s.w, s.h) ||
    isChapterName(s.x, s.y, s.w, s.h) ||
    isScreenNumText(s.text) ||
    isSyncMarkerOnly(s.text) ||
    isNonTranslatableMetadata(s.text)
  )
}

function isScreenTextExcluded(s: RawShape): boolean {
  const region = classifyShapeRegion(s.x, s.y, s.w, s.h)
  return (
    region !== 'screen' ||
    isLayoutChrome(s) ||
    isDirectorNote(s.text)
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

function findFallbackScreenText(shapes: RawShape[]): SlideTextBox[] {
  return shapes
    .filter((s) => {
      if (!s.text.trim() || isScreenTextExcluded(s)) return false
      return classifyShapeRegion(s.x, s.y, s.w, s.h) === 'screen' && !isMenu(s.x, s.y, s.w, s.h)
    })
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map(rawShapeToBox)
}

function toScreenBoxes(shapes: RawShape[], _slideType: SlideType): SlideTextBox[] {
  const primary = shapes
    .filter(
      (s) =>
        s.text.trim() &&
        classifyShapeRegion(s.x, s.y, s.w, s.h) === 'screen' &&
        !isScreenTextExcluded(s),
    )
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((s, i) => rawShapeToBox(s, i))

  if (primary.length > 0) return primary
  return findFallbackScreenText(shapes)
}

function resolveScreenNum(
  screenNumShapes: RawShape[],
  screenBoxes: SlideTextBox[],
): { screenNum: string | null; screenBoxes: SlideTextBox[] } {
  let screenNum = buildScreenNum(screenNumShapes)

  const filtered = screenBoxes.filter((box) => {
    if (!isScreenNumText(box.text)) return true
    if (!screenNum) screenNum = box.text.trim().replace(/_/g, '-')
    return false
  })

  return { screenNum, screenBoxes: filtered }
}

function findSpTree(root: Element): Element | null {
  const cSld = firstChildByLocalName(root, 'cSld')
  if (cSld) return firstChildByLocalName(cSld, 'spTree')
  return firstChildByLocalName(root, 'spTree')
}

function parseSlideWithShapes(
  contentShapes: RawShape[],
  screenNumShapes: RawShape[],
  slideNum: number,
  totalSlides: number,
): ParsedSlide {
  const slideType = classifySlideType(screenNumShapes, slideNum, totalSlides)

  const rawScreenBoxes = toScreenBoxes(contentShapes, slideType)
  const { screenNum, screenBoxes } = resolveScreenNum(screenNumShapes, rawScreenBoxes)
  const narration = collectNarrationBoxes(contentShapes, screenBoxes)

  const cnShapes = screenNumShapes.filter((s) => isCourseName(s.x, s.y, s.w, s.h))
  const chShapes = screenNumShapes.filter((s) => isChapterName(s.x, s.y, s.w, s.h))

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
    screen_desc: null,
    image_nums: null,
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
  const bundle = await createPptxBundle(data)
  const slidePaths = sortSlidePaths(
    Object.keys(bundle.zip.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path)),
  )

  const slides: ParsedSlide[] = []
  const total = slidePaths.length

  for (let i = 0; i < slidePaths.length; i++) {
    const slideNum = i + 1
    const { contentShapes, screenNumShapes } = await getMergedShapesForSlide(bundle, slideNum)
    slides.push(parseSlideWithShapes(contentShapes, screenNumShapes, slideNum, total))

    onProgress?.({ current: i + 1, total, phase: 'parsing' })

    if (i % 3 === 2) {
      await yieldToMainThread()
    }
  }

  return slides
}

export async function parseSingleSlide(
  data: ArrayBuffer | Blob,
  slideNum: number,
): Promise<ParsedSlide> {
  const bundle = await createPptxBundle(data)
  const slidePaths = sortSlidePaths(
    Object.keys(bundle.zip.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path)),
  )
  const total = slidePaths.length
  const path = `ppt/slides/slide${slideNum}.xml`
  if (!bundle.zip.file(path)) {
    throw new Error(`슬라이드 ${slideNum}을(를) 찾을 수 없습니다. (총 ${total}장)`)
  }
  const { contentShapes, screenNumShapes } = await getMergedShapesForSlide(bundle, slideNum)
  return parseSlideWithShapes(contentShapes, screenNumShapes, slideNum, total)
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

export function normalizeNarration(
  raw: SlideTextBox[] | string | null | unknown,
): SlideTextBox[] | null {
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

export function formatNarration(boxes: SlideTextBox[] | string | null | unknown): string {
  const normalized = normalizeNarration(boxes)
  if (!normalized?.length) return ''

  return normalized
    .map((box) => (typeof box === 'object' && box && 'text' in box ? String(box.text ?? '') : ''))
    .filter(Boolean)
    .join('\n')
}

export function parseNarrationInput(
  value: string,
  existing: SlideTextBox[] | string | null,
): SlideTextBox[] | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const normalizedExisting = normalizeNarration(existing)

  if (normalizedExisting?.length) {
    const [first, ...rest] = normalizedExisting
    return [
      { ...first, text: trimmed },
      ...rest.map((box) => ({ ...box, text: '' })),
    ]
  }

  return [{ id: '0', text: trimmed, x: 0, y: 0, w: 0, h: 0 }]
}
