import JSZip from 'jszip'
import { overlapsScreenContent, SB_CX, SB_CY } from './pptxParser'
import { NARRATION_FIELD_KEY } from './lang'
import type { SpellingResult, Translation } from '../types'

const P_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'

interface TextShapeInfo {
  parent: Element
  shape: Element
  text: string
  x: number
  y: number
  w: number
  h: number
  fontSize?: number
}

export interface GenerateVnPptxOptions {
  /** 맞춤법 슬라이드 반영분 — PPTX 원문 ↔ translations.source 매칭용 */
  spellingResults?: SpellingResult[]
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

function extractParagraphText(p: Element): string {
  const runs = elementsByLocalName(p, 't')
  return runs.map((t) => t.textContent ?? '').join('')
}

function extractBodyText(txBody: Element): string {
  const paragraphs = elementsByLocalName(txBody, 'p')
  if (paragraphs.length === 0) return ''
  return paragraphs.map((p) => extractParagraphText(p)).join('\n').trim()
}

function extractFontSize(txBody: Element): number | undefined {
  const sz = firstChildByLocalName(txBody, 'sz')
  if (!sz) return undefined
  const val = sz.getAttribute('val')
  return val ? parseInt(val, 10) : undefined
}

function collectTextShapes(parent: Element, offsetX = 0, offsetY = 0): TextShapeInfo[] {
  const shapes: TextShapeInfo[] = []

  for (const child of Array.from(parent.children)) {
    if (!(child instanceof Element)) continue

    if (child.localName === 'sp') {
      const txBody = firstChildByLocalName(child, 'txBody')
      if (!txBody) continue

      const text = extractBodyText(txBody)
      const { x, y, w, h } = getShapeTransform(child)
      shapes.push({
        parent,
        shape: child,
        text,
        x: x + offsetX,
        y: y + offsetY,
        w,
        h,
        fontSize: extractFontSize(txBody),
      })
    } else if (child.localName === 'grpSp') {
      const { x, y } = getShapeTransform(child)
      shapes.push(...collectTextShapes(child, offsetX + x, offsetY + y))
    }
  }

  return shapes
}

function isNarrationBox(x: number, y: number, w: number, h: number): boolean {
  const yR = y / SB_CY
  const cy = (y + Math.max(h, 1) / 2) / SB_CY
  const xR = x / SB_CX
  if (yR >= 0.78 || cy >= 0.78) return true
  if (cy >= 0.74 && xR < 0.15) return true
  if (w <= 0 && h <= 0 && yR >= 0.54) return true
  return false
}

function isHashNumberOnly(text: string): boolean {
  return /^#\d+\s*$/.test(text.trim())
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function getMaxShapeId(doc: Document): number {
  let max = 1
  for (const el of elementsByLocalName(doc.documentElement, 'cNvPr')) {
    const id = parseInt(el.getAttribute('id') ?? '0', 10)
    if (id > max) max = id
  }
  return max
}

/** 공백·줄바꿈 정규화 (매칭용) */
export function normalizePptxMatchKey(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim()
}

function compactPptxMatchKey(text: string): string {
  return normalizePptxMatchKey(text).replace(/\s+/g, '')
}

function narrationContentKey(text: string): string {
  return compactPptxMatchKey(text.replace(/#\d+/g, ''))
}

function narrationShapeScore(info: TextShapeInfo): number {
  const cy = (info.y + Math.max(info.h, 1) / 2) / SB_CY
  let score = 0
  if (cy >= 0.74) score += 100
  else if (cy >= 0.54) score += 40
  if (/#\d/.test(info.text)) score += 50
  score += Math.min(info.text.length / 50, 40)
  return score
}

function selectPrimaryNarrationShape(shapes: TextShapeInfo[]): TextShapeInfo | null {
  const candidates = shapes.filter(
    (s) => isNarrationBox(s.x, s.y, s.w, s.h) && s.text.trim().length > 0 && !isHashNumberOnly(s.text),
  )
  if (candidates.length === 0) return null
  return [...candidates].sort((a, b) => narrationShapeScore(b) - narrationShapeScore(a))[0]
}

type TranslationIndex = {
  byNorm: Map<string, Translation[]>
  byCompact: Map<string, Translation[]>
}

function pushIndex(map: Map<string, Translation[]>, key: string, tr: Translation): void {
  if (!key) return
  const list = map.get(key) ?? []
  if (!list.some((t) => t.id === tr.id)) list.push(tr)
  map.set(key, list)
}

function buildTranslationIndex(
  translations: Translation[],
  spellingResults: SpellingResult[],
): TranslationIndex {
  const byNorm = new Map<string, Translation[]>()
  const byCompact = new Map<string, Translation[]>()

  for (const tr of translations) {
    pushIndex(byNorm, normalizePptxMatchKey(tr.source), tr)
    pushIndex(byCompact, compactPptxMatchKey(tr.source), tr)
  }

  // PPTX에는 맞춤법 전 원문이 남아 있고, translations.source는 반영본일 수 있음
  for (const sr of spellingResults) {
    if (!sr.committed_to_slide) continue
    const suggestionKey = normalizePptxMatchKey(sr.suggestion)
    const suggestionCompact = compactPptxMatchKey(sr.suggestion)
    const candidates = [
      ...(byNorm.get(suggestionKey) ?? []),
      ...(byCompact.get(suggestionCompact) ?? []),
    ]
    const matched =
      candidates.find((t) => t.slide_id === sr.slide_id && t.field === sr.field) ??
      candidates.find((t) => t.field === sr.field) ??
      candidates[0]
    if (!matched) continue
    pushIndex(byNorm, normalizePptxMatchKey(sr.original), matched)
    pushIndex(byCompact, compactPptxMatchKey(sr.original), matched)
  }

  return { byNorm, byCompact }
}

function pickPreferred(
  matches: Translation[],
  region: 'narration' | 'screen',
  used: Set<string>,
): Translation | undefined {
  const available = matches.filter((t) => !used.has(t.id) && t.vi_text?.trim())
  if (available.length === 0) return undefined

  const preferred = available.find((t) => {
    if (region === 'narration') {
      return t.field === NARRATION_FIELD_KEY || t.field === 'narration'
    }
    return t.field.startsWith('screen_text') || t.field === 'screen_text'
  })

  return preferred ?? available[0]
}

function findTranslation(
  text: string,
  region: 'narration' | 'screen',
  index: TranslationIndex,
  used: Set<string>,
): Translation | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined

  const norm = normalizePptxMatchKey(trimmed)
  const compact = compactPptxMatchKey(trimmed)

  let found = pickPreferred(index.byNorm.get(norm) ?? [], region, used)
  if (!found) found = pickPreferred(index.byCompact.get(compact) ?? [], region, used)

  // 줄바꿈만 다른 부분 일치 (화면텍스트가 PPTX에서 쪼개진 경우 보완)
  if (!found && compact.length >= 12) {
    const fuzzy: Translation[] = []
    for (const [key, list] of index.byCompact) {
      if (key.length < 12) continue
      if (key === compact || key.includes(compact) || compact.includes(key)) {
        fuzzy.push(...list)
      }
    }
    found = pickPreferred(fuzzy, region, used)
  }

  if (found) used.add(found.id)
  return found
}

function buildTextRun(text: string, lang: string, sz: number, color = '0033CC'): string {
  return `<a:r><a:rPr lang="${lang}" sz="${sz}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t xml:space="preserve">${escapeXml(text)}</a:t></a:r>`
}

function buildParagraph(text: string, lang: string, sz: number, color: string): string {
  return `<a:p><a:pPr/>${buildTextRun(text, lang, sz, color)}</a:p>`
}

/** 라벨 없이 한글(맞춤법 반영) + 빈 줄 + 베트남어 */
function buildNarrationTxBodyXml(koText: string, viText: string, sz: number): string {
  const koLines = koText.split('\n')
  const viLines = viText.split('\n')
  const paragraphs = [
    ...koLines.map((line) => buildParagraph(line, 'ko-KR', sz, '000000')),
    '<a:p><a:pPr/></a:p>',
    ...viLines.map((line) => buildParagraph(line, 'vi-VN', sz, '0033CC')),
  ]

  return `<p:txBody xmlns:p="${P_NS}" xmlns:a="${A_NS}"><a:bodyPr wrap="square" rtlCol="0"><a:spAutoFit/></a:bodyPr><a:lstStyle/>${paragraphs.join('')}</p:txBody>`
}

function applyNarrationStyle(shape: Element, doc: Document): void {
  let spPr = firstChildByLocalName(shape, 'spPr')
  if (!spPr) {
    spPr = doc.createElementNS(P_NS, 'p:spPr')
    const txBody = firstChildByLocalName(shape, 'txBody')
    if (txBody) {
      shape.insertBefore(spPr, txBody)
    } else {
      shape.appendChild(spPr)
    }
  }

  const xfrm = firstChildByLocalName(spPr, 'xfrm')
  const prstGeom = firstChildByLocalName(spPr, 'prstGeom')

  spPr.innerHTML = ''

  if (xfrm) spPr.appendChild(xfrm.cloneNode(true))
  if (prstGeom) {
    spPr.appendChild(prstGeom.cloneNode(true))
  } else {
    const geom = doc.createElementNS(A_NS, 'a:prstGeom')
    geom.setAttribute('prst', 'rect')
    const avLst = doc.createElementNS(A_NS, 'a:avLst')
    geom.appendChild(avLst)
    spPr.appendChild(geom)
  }

  const fill = doc.createElementNS(A_NS, 'a:solidFill')
  const fillClr = doc.createElementNS(A_NS, 'a:srgbClr')
  fillClr.setAttribute('val', 'C3D69B')
  fill.appendChild(fillClr)
  spPr.appendChild(fill)

  const ln = doc.createElementNS(A_NS, 'a:ln')
  ln.setAttribute('w', '12700')
  const lnFill = doc.createElementNS(A_NS, 'a:solidFill')
  const lnClr = doc.createElementNS(A_NS, 'a:srgbClr')
  lnClr.setAttribute('val', 'FF0000')
  lnFill.appendChild(lnClr)
  ln.appendChild(lnFill)
  spPr.appendChild(ln)
}

function replaceNarrationShape(shape: Element, doc: Document, koText: string, viText: string): void {
  const oldTxBody = firstChildByLocalName(shape, 'txBody')
  const txBodyDoc = new DOMParser().parseFromString(
    buildNarrationTxBodyXml(koText, viText, 1200),
    'application/xml',
  )
  const newTxBody = txBodyDoc.documentElement
  const imported = doc.importNode(newTxBody, true)

  if (oldTxBody) {
    shape.replaceChild(imported, oldTxBody)
  } else {
    shape.appendChild(imported)
  }

  applyNarrationStyle(shape, doc)
}

/** 중복 나레이션 박스 텍스트만 비움 (박스는 유지) */
function clearShapeText(shape: Element, doc: Document): void {
  const oldTxBody = firstChildByLocalName(shape, 'txBody')
  const emptyXml = `<p:txBody xmlns:p="${P_NS}" xmlns:a="${A_NS}"><a:bodyPr wrap="square" rtlCol="0"/><a:lstStyle/><a:p><a:pPr/><a:endParaRPr lang="ko-KR"/></a:p></p:txBody>`
  const parsed = new DOMParser().parseFromString(emptyXml, 'application/xml')
  const imported = doc.importNode(parsed.documentElement, true)
  if (oldTxBody) {
    shape.replaceChild(imported, oldTxBody)
  }
}

function buildScreenOverlaySpXml(
  shapeId: number,
  x: number,
  y: number,
  w: number,
  viText: string,
  fontSz: number,
): string {
  const textParagraphs = viText
    .split('\n')
    .map((line) => `<a:p><a:pPr/>${buildTextRun(line, 'vi-VN', fontSz)}</a:p>`)
    .join('')

  return `<p:sp xmlns:p="${P_NS}" xmlns:a="${A_NS}">
  <p:nvSpPr>
    <p:cNvPr id="${shapeId}" name="VN Text ${shapeId}"/>
    <p:cNvSpPr txBox="1"/>
    <p:nvPr/>
  </p:nvSpPr>
  <p:spPr>
    <a:xfrm>
      <a:off x="${x}" y="${y}"/>
      <a:ext cx="${w}" cy="0"/>
    </a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    <a:noFill/>
  </p:spPr>
  <p:txBody>
    <a:bodyPr wrap="square" rtlCol="0"><a:spAutoFit/></a:bodyPr>
    <a:lstStyle/>
    ${textParagraphs}
  </p:txBody>
</p:sp>`
}

function insertShapeAfter(
  doc: Document,
  parent: Element,
  reference: Element,
  spXml: string,
): void {
  const parsed = new DOMParser().parseFromString(spXml, 'application/xml')
  const sp = parsed.documentElement
  const imported = doc.importNode(sp, true)

  if (reference.nextSibling) {
    parent.insertBefore(imported, reference.nextSibling)
  } else {
    parent.appendChild(imported)
  }
}

function processSlideXml(
  xml: string,
  _slideNum: number,
  index: TranslationIndex,
): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const spTree = firstChildByLocalName(doc.documentElement, 'cSld')
    ? firstChildByLocalName(firstChildByLocalName(doc.documentElement, 'cSld')!, 'spTree')
    : firstChildByLocalName(doc.documentElement, 'spTree')

  if (!spTree) return xml

  const shapes = collectTextShapes(spTree)
  const usedTranslations = new Set<string>()
  let nextShapeId = getMaxShapeId(doc) + 1

  const overlayInsertions: Array<{ parent: Element; shape: Element; xml: string }> = []

  // ── 나레이션: 단일 박스만 덮어쓰기 (라벨 없이 한글+베트남어) ──
  const primaryNarr = selectPrimaryNarrationShape(shapes)
  if (primaryNarr) {
    const tr = findTranslation(primaryNarr.text, 'narration', index, usedTranslations)
    if (tr?.vi_text.trim()) {
      const koText = tr.source.trim() || primaryNarr.text.trim()
      replaceNarrationShape(primaryNarr.shape, doc, koText, tr.vi_text.trim())

      const primaryKey = narrationContentKey(primaryNarr.text)
      for (const info of shapes) {
        if (info.shape === primaryNarr.shape) continue
        if (!isNarrationBox(info.x, info.y, info.w, info.h)) continue
        if (!info.text.trim() || isHashNumberOnly(info.text)) continue
        const key = narrationContentKey(info.text)
        if (
          key &&
          primaryKey &&
          (key === primaryKey || primaryKey.includes(key) || key.includes(primaryKey))
        ) {
          clearShapeText(info.shape, doc)
        }
      }
    }
  }

  // ── 화면텍스트: 기존 박스 유지 + 하단에 VI 오버레이 ──
  for (const info of shapes) {
    const trimmed = info.text.trim()
    if (!trimmed) continue
    if (isNarrationBox(info.x, info.y, info.w, info.h)) continue
    if (info.y / SB_CY < 0.05) continue
    if (isHashNumberOnly(trimmed)) continue
    if (!overlapsScreenContent(info.x, info.y, info.w, info.h)) continue

    const tr = findTranslation(trimmed, 'screen', index, usedTranslations)
    if (!tr?.vi_text.trim()) continue

    const fontSz = info.fontSize ?? 1200
    const overlayY = info.y + info.h + 30_000
    const spXml = buildScreenOverlaySpXml(
      nextShapeId++,
      info.x,
      overlayY,
      info.w,
      tr.vi_text.trim(),
      fontSz,
    )
    overlayInsertions.push({ parent: info.parent, shape: info.shape, xml: spXml })
  }

  for (const insertion of overlayInsertions) {
    insertShapeAfter(doc, insertion.parent, insertion.shape, insertion.xml)
  }

  return new XMLSerializer().serializeToString(doc)
}

function sortSlidePaths(paths: string[]): string[] {
  return paths.sort((a, b) => {
    const numA = parseInt(a.match(/slide(\d+)\.xml/)?.[1] ?? '0', 10)
    const numB = parseInt(b.match(/slide(\d+)\.xml/)?.[1] ?? '0', 10)
    return numA - numB
  })
}

export async function generateVnPptx(
  sourceFile: File,
  translations: Translation[],
  options: GenerateVnPptxOptions = {},
): Promise<Blob> {
  const buffer = await sourceFile.arrayBuffer()
  const zip = await JSZip.loadAsync(buffer)
  const index = buildTranslationIndex(translations, options.spellingResults ?? [])

  const slidePaths = sortSlidePaths(
    Object.keys(zip.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path)),
  )

  for (let i = 0; i < slidePaths.length; i++) {
    const slideNum = i + 1
    const path = slidePaths[i]
    const xml = await zip.file(path)!.async('string')
    const updated = processSlideXml(xml, slideNum, index)
    zip.file(path, updated)
  }

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  })
}
