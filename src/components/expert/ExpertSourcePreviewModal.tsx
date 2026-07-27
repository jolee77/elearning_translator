import { useEffect, useMemo, useRef } from 'react'
import { formatNarration, formatScreenText } from '../../lib/pptxParser'
import { fieldKeyLabel } from '../../lib/slideFields'
import type { ExpertReviewSlideInfo } from '../../types'

interface ExpertSourcePreviewModalProps {
  open: boolean
  onClose: () => void
  slides: ExpertReviewSlideInfo[]
  /** 현재 검토 중인 슬라이드 id — 열릴 때 해당 슬라이드로 스크롤 */
  focusSlideId?: string | null
  /** 강조할 필드 (screen_text_* / tr_narration 등) */
  highlightField?: string | null
}

function isNarrationField(field: string | null | undefined): boolean {
  return field === 'tr_narration' || field === 'narration'
}

function isScreenField(field: string | null | undefined): boolean {
  return Boolean(field?.startsWith('screen_text') || field === 'screen_text')
}

export function ExpertSourcePreviewModal({
  open,
  onClose,
  slides,
  focusSlideId,
  highlightField,
}: ExpertSourcePreviewModalProps) {
  const focusRef = useRef<HTMLElement | null>(null)

  const sorted = useMemo(
    () => [...slides].sort((a, b) => a.slide_num - b.slide_num),
    [slides],
  )

  useEffect(() => {
    if (!open) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // 포커스 슬라이드로 스크롤
    requestAnimationFrame(() => {
      focusRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    })

    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose, focusSlideId])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
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
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
          <div>
            <h2
              id="expert-source-preview-title"
              className="text-base font-semibold text-gray-900"
            >
              맞춤법 반영 원문
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              업로드 후 맞춤법 검토가 반영된 한국어 원문입니다. 슬라이드 전체를 참고해 번역을
              검토해 주세요.
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

        <div className="nb-h-scroll flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {sorted.length === 0 ? (
            <p className="text-sm text-gray-500">표시할 슬라이드가 없습니다.</p>
          ) : (
            sorted.map((slide) => {
              const isFocus = slide.id === focusSlideId
              const screenText = formatScreenText(slide.screen_text)
              const narration = formatNarration(slide.narration)
              const highlightScreen = isFocus && isScreenField(highlightField)
              const highlightNarration = isFocus && isNarrationField(highlightField)

              return (
                <article
                  key={slide.id}
                  ref={isFocus ? focusRef : undefined}
                  className={`rounded-lg border p-4 ${
                    isFocus ? 'border-[#1E88E5] bg-[#f0f9ff]' : 'border-gray-200 bg-white'
                  }`}
                >
                  <header className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <h3 className="text-sm font-semibold text-gray-900">
                      슬라이드 {slide.slide_num}
                    </h3>
                    {slide.screen_num && (
                      <span className="text-xs text-gray-500">{slide.screen_num}</span>
                    )}
                    {isFocus && highlightField && (
                      <span className="nb-badge nb-badge--pending text-xs">
                        검토 중: {fieldKeyLabel(highlightField)}
                      </span>
                    )}
                  </header>

                  {(slide.course_name || slide.chapter_name || slide.current_section) && (
                    <div className="mb-3 space-y-1 text-xs text-gray-600">
                      {slide.course_name && <p>과정명: {slide.course_name}</p>}
                      {slide.chapter_name && <p>회차명: {slide.chapter_name}</p>}
                      {slide.current_section && <p>목차: {slide.current_section}</p>}
                    </div>
                  )}

                  <div className="space-y-3">
                    <div
                      className={
                        highlightScreen
                          ? 'rounded-lg ring-2 ring-[#1E88E5] ring-offset-2'
                          : undefined
                      }
                    >
                      <p className="nb-field-label">화면 텍스트</p>
                      <p className="mt-1 whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-800">
                        {screenText.trim() || '(없음)'}
                      </p>
                    </div>
                    <div
                      className={
                        highlightNarration
                          ? 'rounded-lg ring-2 ring-[#1E88E5] ring-offset-2'
                          : undefined
                      }
                    >
                      <p className="nb-field-label">나레이션</p>
                      <p className="mt-1 whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-800">
                        {narration.trim() || '(없음)'}
                      </p>
                    </div>
                  </div>
                </article>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
