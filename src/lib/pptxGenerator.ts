import JSZip from 'jszip'
import { SB_CX, SB_CY } from './pptxParser'
import { NARRATION_FIELD_KEY } from './lang'
import type { Translation } from '../types'

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

function isNarrationBox(x: number, y: number): boolean {
  const xR = x / SB_CX
  const yR = y / SB_CY
  if (yR >= 0.78) return true
  return yR >= 0.74 && yR < 0.86 && xR < 0.15
}

function isScreenTextBox(x: number, y: number, _w: number): boolean {
  const xR = x / SB_CX
  const yR = y / SB_CY
  return xR >= 0.13 && xR < 0.75 && yR >= 0.08 && yR < 0.78
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

function findTranslation(
  text: string,
  region: 'narration' | 'screen',
  translations: Translation[],
  used: Set<string>,
): Translation | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined

  const matches = translations.filter(
    (t) => !used.has(t.id) && t.source.trim() === trimmed,
  )

  const preferred = matches.find((t) => {
    if (region === 'narration') {
      return t.field === NARRATION_FIELD_KEY || t.field === 'narration'
    }
    return t.field.startsWith('screen_text') || t.field === 'screen_text'
  })

  const found = preferred ?? matches[0]
  if (found) used.add(found.id)
  return found
}

function buildTextRun(text: string, lang: string, sz: number, color = '0033CC'): string {
  return `<a:r><a:rPr lang="${lang}" sz="${sz}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t xml:space="preserve">${escapeXml(text)}</a:t></a:r>`
}

function buildParagraph(text: string, lang: string, sz: number, color = '0033CC'): string {
  return `<a:p><a:pPr/><a:r><a:rPr lang="${lang}" sz="${sz}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t xml:space="preserve">${escapeXml(text)}</a:t></a:r></a:p>`
}

function buildNarrationTxBodyXml(koText: string, viText: string, sz: number): string {
  const paragraphs = [
    buildParagraph('[한글(ko)]', 'ko-KR', sz),
    buildParagraph(koText, 'ko-KR', sz),
    '<a:p><a:pPr/></a:p>',
    buildParagraph('[베트남어(vi)]', 'vi-VN', sz),
    buildParagraph(viText, 'vi-VN', sz),
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

function processSlideXml(xml: string, slideNum: number, translations: Translation[]): string {
  if (slideNum <= 9) return xml

  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const spTree = firstChildByLocalName(doc.documentElement, 'cSld')
    ? firstChildByLocalName(firstChildByLocalName(doc.documentElement, 'cSld')!, 'spTree')
    : firstChildByLocalName(doc.documentElement, 'spTree')

  if (!spTree) return xml

  const shapes = collectTextShapes(spTree)
  const usedTranslations = new Set<string>()
  let nextShapeId = getMaxShapeId(doc) + 1

  const overlayInsertions: Array<{ parent: Element; shape: Element; xml: string }> = []

  for (const info of shapes) {
    const trimmed = info.text.trim()
    if (!trimmed) continue

    if (isNarrationBox(info.x, info.y)) {
      const tr = findTranslation(trimmed, 'narration', translations, usedTranslations)
      if (tr?.vi_text.trim()) {
        replaceNarrationShape(info.shape, doc, trimmed, tr.vi_text.trim())
      }
      continue
    }

    if (info.y / SB_CY < 0.05) continue
    if (isHashNumberOnly(trimmed)) continue
    if (!isScreenTextBox(info.x, info.y, info.w)) continue

    const tr = findTranslation(trimmed, 'screen', translations, usedTranslations)
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
): Promise<Blob> {
  const buffer = await sourceFile.arrayBuffer()
  const zip = await JSZip.loadAsync(buffer)

  const slidePaths = sortSlidePaths(
    Object.keys(zip.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path)),
  )

  for (let i = 0; i < slidePaths.length; i++) {
    const slideNum = i + 1
    const path = slidePaths[i]
    const xml = await zip.file(path)!.async('string')
    const updated = processSlideXml(xml, slideNum, translations)
    zip.file(path, updated)
  }

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  })
}
