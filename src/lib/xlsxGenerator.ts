import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'
import { SLIDE_TYPE_LABELS, formatNarration, formatScreenText } from './pptxParser'
import { getLangConfig, NARRATION_FIELD_KEY } from './lang'
import { fieldKeyLabel, isTranslationFieldExcluded } from './slideFields'
import type { ChangeLog, ChangeLogAction, Project, Slide, Translation } from '../types'

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  // 큰 PPTX는 revoke가 너무 빠르면 다운로드가 취소됨
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function downloadExtractionXlsx(slides: Slide[], filename: string): void {
  const rows = slides.map((slide) => ({
    슬라이드번호: slide.slide_num,
    유형: SLIDE_TYPE_LABELS[slide.slide_type],
    화면번호: slide.screen_num ?? '',
    화면텍스트: formatScreenText(slide.screen_text),
    나레이션: formatNarration(slide.narration),
    과정명: slide.course_name ?? '',
    회차명: slide.chapter_name ?? '',
    화면설명: slide.screen_desc ?? '',
    이미지번호: slide.image_nums ?? '',
  }))

  const worksheet = XLSX.utils.json_to_sheet(rows)
  worksheet['!cols'] = [
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 48 },
    { wch: 48 },
    { wch: 18 },
    { wch: 28 },
    { wch: 16 },
    { wch: 12 },
  ]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, '추출결과')
  XLSX.writeFile(workbook, filename)
}

const CHANGE_LOG_ACTION_LABELS: Record<ChangeLogAction, string> = {
  project_created: '프로젝트 생성',
  pptx_uploaded: 'PPTX 업로드',
  extraction_done: '추출 완료',
  spelling_applied: '맞춤법 반영',
  spelling_reverted: '맞춤법 되돌림',
  slide_selection_done: '번역 대상 선택',
  translation_done: '번역 완료',
  translation_edited: '번역문 수정',
  verification_applied: '역번역 검증 반영',
  verification_edited: '역번역 후 수정',
  expert_review_sent: '전문가 검증 요청',
  expert_review_edited: '전문가 번역 수정',
  expert_review_done: '전문가 검증 완료',
  expert_review_skipped: '전문가 검증 건너뛰기',
  download: '다운로드',
}

const STAGE_LABELS: Record<string, string> = {
  spelling: '맞춤법',
  translation: '번역',
  verification: '역번역',
  expert_review: '전문가 검증',
}

type SheetRow = string[]

export interface XlsxActorContext {
  /** user_id → 표시 이름 */
  profileNames: Record<string, string>
  /** 전문가 검증 담당자 이름 */
  expertName?: string | null
}

function findViByKoText(translations: Translation[], koText: string): string {
  const match = translations.find((t) => t.source.trim() === koText.trim())
  return match?.vi_text ?? ''
}

function buildTranslationRows(
  slides: Slide[],
  translations: Translation[],
  includeVi: boolean,
  targetLangName: string,
): SheetRow[] {
  const rows: SheetRow[] = includeVi
    ? [['구분', '유형', '한글', targetLangName]]
    : [['구분', '유형', '한글']]

  const contentSlides = slides.filter((s) => s.slide_type !== 'guide' && !s.exclude_from_translation)
  const referenceSlide = contentSlides[0] ?? slides[0]

  const courseKo = referenceSlide?.course_name ?? ''
  const chapterKo = referenceSlide?.chapter_name ?? ''
  const courseVi = includeVi ? findViByKoText(translations, courseKo) : ''
  const chapterVi = includeVi ? findViByKoText(translations, chapterKo) : ''

  rows.push(includeVi ? ['과정명', '', courseKo, courseVi] : ['과정명', '', courseKo])
  rows.push(includeVi ? ['차시명', '', chapterKo, chapterVi] : ['차시명', '', chapterKo])

  const translationsBySlide = new Map<string, Translation[]>()
  for (const tr of translations) {
    const list = translationsBySlide.get(tr.slide_id) ?? []
    list.push(tr)
    translationsBySlide.set(tr.slide_id, list)
  }

  for (const slide of contentSlides) {
    const slideTranslations = translationsBySlide.get(slide.id) ?? []
    const courseName = slide.course_name ?? ''
    const courseViText = includeVi ? findViByKoText(slideTranslations, courseName) : ''

    rows.push(
      includeVi
        ? [String(slide.slide_num), '', courseName, courseViText]
        : [String(slide.slide_num), '', courseName],
    )

    const screenTranslations = slideTranslations
      .filter((t) => t.field.startsWith('screen_text') || t.field === 'screen_text')
      .filter((t) => !isTranslationFieldExcluded(slide, t.field))
      .sort((a, b) => a.field.localeCompare(b.field))

    for (const tr of screenTranslations) {
      rows.push(
        includeVi
          ? ['', '화면 텍스트', tr.source, tr.vi_text]
          : ['', '화면 텍스트', tr.source],
      )
    }

    const narrationTr = slideTranslations.find(
      (t) =>
        (t.field === NARRATION_FIELD_KEY || t.field === 'narration') &&
        !isTranslationFieldExcluded(slide, t.field),
    )
    if (narrationTr) {
      rows.push(
        includeVi
          ? ['', '나레이션', narrationTr.source, narrationTr.vi_text]
          : ['', '나레이션', narrationTr.source],
      )
    }
  }

  return rows
}

function resolveChangeItem(log: ChangeLog): string {
  const meta = log.metadata ?? {}
  if (typeof meta.field === 'string' && meta.field) {
    return fieldKeyLabel(meta.field)
  }
  if (log.field) {
    return fieldKeyLabel(log.field)
  }
  if (log.detail?.trim()) {
    return log.detail.trim()
  }
  return ''
}

function resolveEditorName(log: ChangeLog, actors: XlsxActorContext): string {
  const meta = log.metadata ?? {}
  if (typeof log.changed_by === 'string' && log.changed_by.trim()) {
    return log.changed_by.trim()
  }
  if (typeof meta.editor === 'string' && meta.editor.trim()) {
    return meta.editor.trim()
  }
  if (log.action?.startsWith('expert_review') && actors.expertName?.trim()) {
    return actors.expertName.trim()
  }
  if (log.user_id && actors.profileNames[log.user_id]) {
    return actors.profileNames[log.user_id]
  }
  return actors.expertName?.trim() || ''
}

function resolveStageLabel(log: ChangeLog): string {
  if (log.action && CHANGE_LOG_ACTION_LABELS[log.action]) {
    return CHANGE_LOG_ACTION_LABELS[log.action]
  }
  if (log.stage && STAGE_LABELS[log.stage]) {
    return STAGE_LABELS[log.stage]
  }
  return log.action ?? log.stage ?? ''
}

/** 변경이력: 단계 | 항목 | 수정자 | 일시 (슬라이드·수정전·수정후 열 제외) */
function buildChangeLogRows(changeLogs: ChangeLog[], actors: XlsxActorContext): SheetRow[] {
  const rows: SheetRow[] = [['단계', '항목', '수정자', '일시']]

  for (const log of changeLogs) {
    rows.push([
      resolveStageLabel(log),
      resolveChangeItem(log),
      resolveEditorName(log, actors),
      new Date(log.changed_at).toLocaleString('ko-KR'),
    ])
  }

  return rows
}

/** A4 가로 한 페이지 너비에 맞춘 열 너비 (약 100~110자폭) */
const KO_VI_COL_WIDTHS = [8, 12, 42, 42]
const KO_ONLY_COL_WIDTHS = [8, 12, 70]
const CHANGE_COL_WIDTHS = [16, 28, 16, 22]

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF162B52' },
}
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: 'FFFFFFFF' },
  size: 11,
  name: 'Malgun Gothic',
}
const BODY_FONT: Partial<ExcelJS.Font> = {
  size: 10,
  name: 'Malgun Gothic',
}
const WRAP_ALIGN: Partial<ExcelJS.Alignment> = {
  wrapText: true,
  vertical: 'top',
}

function applyA4LandscapePage(ws: ExcelJS.Worksheet): void {
  ws.pageSetup = {
    paperSize: 9, // A4
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: {
      left: 0.4,
      right: 0.4,
      top: 0.5,
      bottom: 0.5,
      header: 0.2,
      footer: 0.2,
    },
  }
  ws.properties.defaultRowHeight = 18
}

function writeRowsToSheet(
  ws: ExcelJS.Worksheet,
  rows: SheetRow[],
  colWidths: number[],
  wrapTextCols: number[],
): void {
  colWidths.forEach((wch, i) => {
    ws.getColumn(i + 1).width = wch
  })

  rows.forEach((row, rowIdx) => {
    const excelRow = ws.getRow(rowIdx + 1)
    row.forEach((value, colIdx) => {
      const cell = excelRow.getCell(colIdx + 1)
      cell.value = value
      cell.font = rowIdx === 0 ? HEADER_FONT : BODY_FONT
      if (rowIdx === 0) {
        cell.fill = HEADER_FILL
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      } else if (wrapTextCols.includes(colIdx)) {
        cell.alignment = WRAP_ALIGN
      } else {
        cell.alignment = { vertical: 'top' }
      }
    })

    if (rowIdx === 0) {
      excelRow.height = 22
    } else {
      const textCols = wrapTextCols.map((i) => String(row[i] ?? ''))
      const maxLen = Math.max(0, ...textCols.map((t) => t.length))
      const approxLines = Math.max(1, Math.ceil(maxLen / 36), ...textCols.map((t) => t.split('\n').length))
      excelRow.height = Math.min(120, Math.max(18, approxLines * 15))
    }
  })

  applyA4LandscapePage(ws)
}

export async function generateTranslationXlsx(
  project: Project,
  slides: Slide[],
  translations: Translation[],
  changeLogs: ChangeLog[],
  actors: XlsxActorContext = { profileNames: {} },
): Promise<Blob> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'elearning-translator'
  const targetLangName = getLangConfig(project.target_lang).name

  const koViRows = buildTranslationRows(slides, translations, true, targetLangName)
  const koOnlyRows = buildTranslationRows(slides, translations, false, targetLangName)
  const changeRows = buildChangeLogRows(changeLogs, actors)

  const koViSheet = workbook.addWorksheet('국문-목적언어')
  writeRowsToSheet(koViSheet, koViRows, KO_VI_COL_WIDTHS, [2, 3])

  const koSheet = workbook.addWorksheet('국문')
  writeRowsToSheet(koSheet, koOnlyRows, KO_ONLY_COL_WIDTHS, [2])

  const changeSheet = workbook.addWorksheet('변경이력')
  writeRowsToSheet(changeSheet, changeRows, CHANGE_COL_WIDTHS, [1])

  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
