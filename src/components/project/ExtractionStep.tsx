import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  SLIDE_TYPE_LABELS,
  formatScreenText,
  parseScreenTextInput,
} from '../../lib/pptxParser'
import { downloadExtractionXlsx } from '../../lib/xlsxGenerator'
import {
  useBulkUpdateSlides,
  useCompleteExtraction,
  useExtractSlides,
  useSlides,
} from '../../hooks/useSlides'
import { useToast } from '../../hooks/ToastProvider'
import { Spinner } from '../ui/Spinner'
import type { Project } from '../../types'
import type { Slide, SlideType } from '../../types'

const FILTER_TYPES: Array<{ value: SlideType | 'all'; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'intro', label: '인트로' },
  { value: 'lesson', label: '레슨' },
  { value: 'content', label: '콘텐츠' },
  { value: 'divider', label: '간지' },
  { value: 'quiz', label: '문제풀기' },
  { value: 'apply', label: '적용하기' },
  { value: 'outro', label: '아웃트로' },
]

interface ExtractionStepProps {
  project: Project
}

export function ExtractionStep({ project }: ExtractionStepProps) {
  const { showToast } = useToast()
  const { data: slides = [], isLoading: slidesLoading } = useSlides(project.id)
  const extractSlides = useExtractSlides()
  const bulkUpdate = useBulkUpdateSlides()
  const completeExtraction = useCompleteExtraction()

  const [localSlides, setLocalSlides] = useState<Slide[]>([])
  const [typeFilter, setTypeFilter] = useState<SlideType | 'all'>('all')
  const [autoExtractAttempted, setAutoExtractAttempted] = useState(false)

  useEffect(() => {
    if (slides.length > 0) {
      setLocalSlides(slides)
    }
  }, [slides])

  const runExtraction = useCallback(async () => {
    if (!project.ko_pptx_path) {
      showToast('PPTX 파일 경로가 없습니다.', 'error')
      return
    }

    try {
      const result = await extractSlides.mutateAsync({
        projectId: project.id,
        storagePath: project.ko_pptx_path,
      })
      setLocalSlides(result)
      showToast('PPTX 추출이 완료되었습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'PPTX 추출에 실패했습니다.', 'error')
    }
  }, [extractSlides, project.id, project.ko_pptx_path, showToast])

  useEffect(() => {
    if (
      !slidesLoading &&
      slides.length === 0 &&
      !autoExtractAttempted &&
      !extractSlides.isPending &&
      project.ko_pptx_path
    ) {
      setAutoExtractAttempted(true)
      runExtraction()
    }
  }, [
    slidesLoading,
    slides.length,
    autoExtractAttempted,
    extractSlides.isPending,
    project.ko_pptx_path,
    runExtraction,
  ])

  const filteredSlides = useMemo(() => {
    if (typeFilter === 'all') return localSlides
    return localSlides.filter((s) => s.slide_type === typeFilter)
  }, [localSlides, typeFilter])

  const missingNarrationSlides = useMemo(
    () => localSlides.filter((s) => !s.narration?.trim()),
    [localSlides],
  )

  const updateLocalSlide = (id: string, field: 'screen_text' | 'narration' | 'screen_num', value: string) => {
    setLocalSlides((prev) =>
      prev.map((slide) => {
        if (slide.id !== id) return slide

        if (field === 'screen_text') {
          return { ...slide, screen_text: parseScreenTextInput(value, slide.screen_text) }
        }
        if (field === 'narration') {
          return { ...slide, narration: value || null }
        }
        return { ...slide, screen_num: value || null }
      }),
    )
  }

  const handleSaveEdits = async () => {
    try {
      await bulkUpdate.mutateAsync({ projectId: project.id, slides: localSlides })
      showToast('변경사항이 저장되었습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '저장에 실패했습니다.', 'error')
    }
  }

  const handleComplete = async () => {
    try {
      await completeExtraction.mutateAsync({ projectId: project.id, slides: localSlides })
      showToast('추출이 완료되었습니다. 다음 단계로 진행할 수 있습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '추출 완료 처리에 실패했습니다.', 'error')
    }
  }

  const handleDownloadXlsx = () => {
    const safeTitle = project.title.replace(/[\\/:*?"<>|]/g, '_')
    downloadExtractionXlsx(localSlides, `${safeTitle}_추출결과.xlsx`)
  }

  const isExtracting = extractSlides.isPending
  const isBusy = isExtracting || bulkUpdate.isPending || completeExtraction.isPending
  const isExtracted = project.status !== 'uploaded'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Step 1. 추출 확인</h3>
          <p className="mt-0.5 text-sm text-gray-500">
            PPTX에서 슬라이드별 텍스트를 추출하고 내용을 확인·수정합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setAutoExtractAttempted(true)
              runExtraction()
            }}
            disabled={isBusy || !project.ko_pptx_path}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            {isExtracting && <Spinner />}
            {isExtracting ? '추출 중...' : '다시 추출'}
          </button>
          <button
            type="button"
            onClick={handleSaveEdits}
            disabled={isBusy || localSlides.length === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            {bulkUpdate.isPending && <Spinner />}
            {bulkUpdate.isPending ? '저장 중...' : '변경사항 저장'}
          </button>
          <button
            type="button"
            onClick={handleDownloadXlsx}
            disabled={localSlides.length === 0}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            XLSX 다운로드
          </button>
          <button
            type="button"
            onClick={handleComplete}
            disabled={isBusy || localSlides.length === 0 || isExtracted}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-600 disabled:opacity-50"
          >
            {completeExtraction.isPending && <Spinner className="text-white" />}
            {completeExtraction.isPending ? '처리 중...' : '추출 완료'}
          </button>
        </div>
      </div>

      {isExtracting && (
        <div className="rounded-lg bg-blue-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-blue-700">
            <Spinner className="text-blue-600" />
            PPTX 파일을 분석하고 있습니다...
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-blue-200">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-accent" />
          </div>
        </div>
      )}

      {missingNarrationSlides.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-800">
            나레이션이 없는 슬라이드 {missingNarrationSlides.length}개
          </p>
          <p className="mt-1 text-xs text-amber-700">
            슬라이드 번호:{' '}
            {missingNarrationSlides.map((s) => s.slide_num).join(', ')}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {FILTER_TYPES.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => setTypeFilter(filter.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              typeFilter === filter.value
                ? 'bg-primary text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {filter.label}
            {filter.value === 'all'
              ? ` (${localSlides.length})`
              : ` (${localSlides.filter((s) => s.slide_type === filter.value).length})`}
          </button>
        ))}
      </div>

      {slidesLoading || isExtracting ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-16">
          <Spinner className="text-gray-400" />
          <p className="text-sm text-gray-500">슬라이드 데이터를 불러오는 중...</p>
        </div>
      ) : localSlides.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-sm text-gray-500">추출된 슬라이드가 없습니다.</p>
          <button
            type="button"
            onClick={runExtraction}
            disabled={!project.ko_pptx_path}
            className="mt-3 text-sm font-medium text-accent hover:underline disabled:opacity-50"
          >
            PPTX 추출 시작
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">슬라이드번호</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">유형</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">섹션</th>
                  <th className="min-w-[240px] px-4 py-3 text-left font-medium text-gray-600">
                    화면텍스트
                  </th>
                  <th className="min-w-[240px] px-4 py-3 text-left font-medium text-gray-600">
                    나레이션
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredSlides.map((slide) => {
                  const noNarration = !slide.narration?.trim()
                  return (
                    <tr
                      key={slide.id}
                      className={noNarration ? 'bg-amber-50/50' : 'hover:bg-gray-50/50'}
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">
                        {slide.slide_num}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                          {SLIDE_TYPE_LABELS[slide.slide_type]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={slide.screen_num ?? ''}
                          onChange={(e) =>
                            updateLocalSlide(slide.id, 'screen_num', e.target.value)
                          }
                          className="w-full min-w-[80px] rounded border border-gray-200 px-2 py-1 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <textarea
                          value={formatScreenText(slide.screen_text)}
                          onChange={(e) =>
                            updateLocalSlide(slide.id, 'screen_text', e.target.value)
                          }
                          rows={3}
                          className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <textarea
                          value={slide.narration ?? ''}
                          onChange={(e) =>
                            updateLocalSlide(slide.id, 'narration', e.target.value)
                          }
                          rows={3}
                          placeholder={noNarration ? '나레이션 없음' : ''}
                          className={`w-full rounded border px-2 py-1 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 ${
                            noNarration ? 'border-amber-300 bg-amber-50' : 'border-gray-200'
                          }`}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {filteredSlides.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-gray-500">
              선택한 유형의 슬라이드가 없습니다.
            </p>
          )}
        </div>
      )}

      {isExtracted && (
        <p className="text-sm text-emerald-600">추출이 완료되었습니다. 다음 단계로 진행할 수 있습니다.</p>
      )}
    </div>
  )
}
