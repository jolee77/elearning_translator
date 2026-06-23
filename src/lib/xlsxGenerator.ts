import * as XLSX from 'xlsx'
import { SLIDE_TYPE_LABELS, formatScreenText } from './pptxParser'
import { NARRATION_FIELD_KEY } from './lang'
import { fieldKeyLabel } from './slideFields'
import type { ChangeLog, ChangeLogAction, Project, Slide, Translation } from '../types'

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function downloadExtractionXlsx(slides: Slide[], filename: string): void {
  const rows = slides.map((slide) => ({
    슬라이드번호: slide.slide_num,
    유형: SLIDE_TYPE_LABELS[slide.slide_type],
    섹션: slide.screen_num ?? '',
    화면텍스트: formatScreenText(slide.screen_text),
    나레이션: slide.narration ?? '',
    과정명: slide.course_name ?? '',
    회차명: slide.chapter_name ?? '',
    목차: slide.menu_text ?? '',
    화면설명: slide.screen_desc ?? '',
    이미지번호: slide.image_num ?? '',
  }))

  const worksheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, '추출결과')
  XLSX.writeFile(workbook, filename)
}

const CHANGE_LOG_ACTION_LABELS: Record<ChangeLogAction, string> = {
  project_created: '프로젝트 생성',
  pptx_uploaded: 'PPTX 업로드',
  extraction_done: '추출 완료',
  spelling_applied: '맞춤법 반영',
  translation_done: '번역 완료',
  verification_applied: '역번역 검증 반영',
  expert_review_sent: '전문가 검증 요청',
  expert_review_done: '전문가 검증 완료',
  download: '다운로드',
}

type SheetRow = string[]

function findViByKoText(translations: Translation[], koText: string): string {
  const match = translations.find((t) => t.ko_text.trim() === koText.trim())
  return match?.vi_text ?? ''
}

function buildTranslationRows(
  slides: Slide[],
  translations: Translation[],
  includeVi: boolean,
): SheetRow[] {
  const rows: SheetRow[] = [
    ['구분', '한글(ko)', includeVi ? '베트남어(vi)' : '', '', '', '비고'],
  ]

  const contentSlides = slides.filter((s) => s.slide_type !== 'guide')
  const referenceSlide = contentSlides[0] ?? slides[0]

  const courseKo = referenceSlide?.course_name ?? ''
  const chapterKo = referenceSlide?.chapter_name ?? ''
  const courseVi = includeVi ? findViByKoText(translations, courseKo) : ''
  const chapterVi = includeVi ? findViByKoText(translations, chapterKo) : ''

  rows.push(['과정명', courseKo, courseVi, '', '', ''])
  rows.push(['차시명', chapterKo, chapterVi, '', '', '화면 텍스트'])

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

    rows.push([String(slide.slide_num), courseName, courseViText, '', '', ''])

    const screenTranslations = slideTranslations
      .filter(
        (t) =>
          t.field_key.startsWith('screen_text') || t.field_key === 'screen_text',
      )
      .sort((a, b) => a.field_key.localeCompare(b.field_key))

    for (const tr of screenTranslations) {
      rows.push(['', tr.ko_text, includeVi ? tr.vi_text : '', '', '', ''])
    }

    const narrationTr = slideTranslations.find(
      (t) => t.field_key === NARRATION_FIELD_KEY || t.field_key === 'narration',
    )
    if (narrationTr) {
      rows.push([
        '',
        narrationTr.ko_text,
        includeVi ? narrationTr.vi_text : '',
        '',
        '',
        '내레이션 텍스트',
      ])
    }
  }

  return rows
}

function buildChangeLogRows(changeLogs: ChangeLog[]): SheetRow[] {
  const rows: SheetRow[] = [
    ['단계', '슬라이드', '항목', '수정 전', '수정 후', '수정자', '일시'],
  ]

  for (const log of changeLogs) {
    const meta = log.metadata ?? {}
    const slide =
      typeof meta.slide_num === 'number'
        ? String(meta.slide_num)
        : typeof meta.slide_num === 'string'
          ? meta.slide_num
          : ''
    const item =
      typeof meta.field_key === 'string'
        ? fieldKeyLabel(meta.field_key)
        : (log.detail ?? '')
    const before = typeof meta.before === 'string' ? meta.before : ''
    const after = typeof meta.after === 'string' ? meta.after : ''
    const editor = typeof meta.editor === 'string' ? meta.editor : (log.user_id ?? '')

    rows.push([
      CHANGE_LOG_ACTION_LABELS[log.action] ?? log.action,
      slide,
      item,
      before,
      after,
      editor,
      new Date(log.created_at).toLocaleString('ko-KR'),
    ])
  }

  return rows
}

function rowsToSheet(rows: SheetRow[]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows)
}

function workbookToBlob(workbook: XLSX.WorkBook): Blob {
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export function generateTranslationXlsx(
  _project: Project,
  slides: Slide[],
  translations: Translation[],
  changeLogs: ChangeLog[],
): Blob {
  const workbook = XLSX.utils.book_new()

  const koViRows = buildTranslationRows(slides, translations, true)
  const koOnlyRows = buildTranslationRows(slides, translations, false)
  const changeRows = buildChangeLogRows(changeLogs)

  XLSX.utils.book_append_sheet(workbook, rowsToSheet(koViRows), '국문-베트남어')
  XLSX.utils.book_append_sheet(workbook, rowsToSheet(koOnlyRows), '국문')
  XLSX.utils.book_append_sheet(workbook, rowsToSheet(changeRows), '변경이력')

  return workbookToBlob(workbook)
}
