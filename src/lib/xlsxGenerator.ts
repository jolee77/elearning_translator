import * as XLSX from 'xlsx'
import { SLIDE_TYPE_LABELS, formatNarration, formatScreenText } from './pptxParser'
import { getLangConfig, NARRATION_FIELD_KEY } from './lang'
import { fieldKeyLabel } from './slideFields'
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
  translation_done: '번역 완료',
  translation_edited: '번역문 수정',
  verification_applied: '역번역 검증 반영',
  verification_edited: '역번역 후 수정',
  expert_review_sent: '전문가 검증 요청',
  expert_review_edited: '전문가 번역 수정',
  expert_review_done: '전문가 검증 완료',
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

  const contentSlides = slides.filter((s) => s.slide_type !== 'guide')
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
      .sort((a, b) => a.field.localeCompare(b.field))

    for (const tr of screenTranslations) {
      rows.push(
        includeVi
          ? ['', '화면 텍스트', tr.source, tr.vi_text]
          : ['', '화면 텍스트', tr.source],
      )
    }

    const narrationTr = slideTranslations.find(
      (t) => t.field === NARRATION_FIELD_KEY || t.field === 'narration',
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
  project: Project,
  slides: Slide[],
  translations: Translation[],
  changeLogs: ChangeLog[],
  actors: XlsxActorContext = { profileNames: {} },
): Blob {
  const workbook = XLSX.utils.book_new()
  const targetLangName = getLangConfig(project.target_lang).name

  const koViRows = buildTranslationRows(slides, translations, true, targetLangName)
  const koOnlyRows = buildTranslationRows(slides, translations, false, targetLangName)
  const changeRows = buildChangeLogRows(changeLogs, actors)

  XLSX.utils.book_append_sheet(workbook, rowsToSheet(koViRows), '국문-목적언어')
  XLSX.utils.book_append_sheet(workbook, rowsToSheet(koOnlyRows), '국문')
  XLSX.utils.book_append_sheet(workbook, rowsToSheet(changeRows), '변경이력')

  return workbookToBlob(workbook)
}
