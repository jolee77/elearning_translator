import { useCallback, useEffect, useMemo, useState, startTransition } from 'react'
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
  type ParseProgress,
} from '../../hooks/useSlides'
import { useToast } from '../../hooks/ToastProvider'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { ChunkProgressPanel } from '../ui/ChunkProgressPanel'
import { Spinner } from '../ui/Spinner'
import type { ChunkProgress } from '../../lib/chunkProgress'
import type { Project } from '../../types'
import type { Slide, SlideType } from '../../types'

const PAGE_SIZE = 20

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
  return (
    <ErrorBoundary>
      <ExtractionStepContent project={project} />
    </ErrorBoundary>
  )
}

function ExtractionStepContent({ project }: ExtractionStepProps) {
  const { showToast } = useToast()
  const { data: slides = [], isLoading: slidesLoading } = useSlides(project.id)
  const extractSlides = useExtractSlides()
  const bulkUpdate = useBulkUpdateSlides()
  const completeExtraction = useCompleteExtraction()

  const [localSlides, setLocalSlides] = useState<Slide[]>([])
  const [typeFilter, setTypeFilter] = useState<SlideType | 'all'>('all')
  const [autoExtractAttempted, setAutoExtractAttempted] = useState(false)
  const [page, setPage] = useState(0)
  const [extractProgress, setExtractProgress] = useState<ParseProgress | null>(null)

  useEffect(() => {
    if (slides.length > 0) {
      startTransition(() => {
        setLocalSlides(slides)
        setPage(0)
      })
    }
  }, [slides])

  const runExtraction = useCallback(async () => {
    if (!project.source_pptx_url) {
      showToast('PPTX 파일 경로가 없습니다.', 'error')
      return
    }

    try {
      setExtractProgress(null)
      const result = await extractSlides.mutateAsync({
        projectId: project.id,
        storagePath: project.source_pptx_url,
        onProgress: setExtractProgress,
      })
      startTransition(() => {
        setLocalSlides(result)
        setPage(0)
      })
      showToast('PPTX 추출이 완료되었습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'PPTX 추출에 실패했습니다.', 'error')
    } finally {
      setExtractProgress(null)
    }
  }, [extractSlides, project.id, project.source_pptx_url, showToast])

  useEffect(() => {
    if (
      !slidesLoading &&
      slides.length === 0 &&
      !autoExtractAttempted &&
      !extractSlides.isPending &&
      project.source_pptx_url
    ) {
      setAutoExtractAttempted(true)
      runExtraction()
    }
  }, [
    slidesLoading,
    slides.length,
    autoExtractAttempted,
    extractSlides.isPending,
    project.source_pptx_url,
    runExtraction,
  ])

  const filteredSlides = useMemo(() => {
    if (typeFilter === 'all') return localSlides
    return localSlides.filter((s) => s.slide_type === typeFilter)
  }, [localSlides, typeFilter])

  const totalPages = Math.max(1, Math.ceil(filteredSlides.length / PAGE_SIZE))

  const pagedSlides = useMemo(() => {
    const safePage = Math.min(page, totalPages - 1)
    const start = safePage * PAGE_SIZE
    return filteredSlides.slice(start, start + PAGE_SIZE)
  }, [filteredSlides, page, totalPages])

  useEffect(() => {
    setPage(0)
  }, [typeFilter])

  useEffect(() => {
    if (page >= totalPages) {
      setPage(Math.max(0, totalPages - 1))
    }
  }, [page, totalPages])

  const missingNarrationSlides = useMemo(
    () => localSlides.filter((s) => !s.narration?.trim()),
    [localSlides],
  )

  const missingNarrationSummary = useMemo(() => {
    const nums = missingNarrationSlides.map((s) => s.slide_num)
    if (nums.length <= 20) return nums.join(', ')
    return `${nums.slice(0, 20).join(', ')} 외 ${nums.length - 20}개`
  }, [missingNarrationSlides])

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

  const extractChunkProgress: ChunkProgress | null = extractProgress
    ? {
        current: extractProgress.current,
        total: extractProgress.total,
        phase:
          extractProgress.phase === 'parsing' ? 'PPTX 슬라이드 분석' : '추출 결과 저장',
        percent: Math.round((extractProgress.current / Math.max(extractProgress.total, 1)) * 100),
      }
    : null
  const isBusy = isExtracting || bulkUpdate.isPending || completeExtraction.isPending
  const isExtracted = project.status !== 'uploaded'

  return (
    <div className="space-y-4">
      <div className="nb-page-toolbar">
        <div>
          <h3 className="nb-step-title">Step 1. 추출 확인</h3>
          <p className="nb-step-desc">
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
            disabled={isBusy || !project.source_pptx_url}
            className="nb-btn-secondary"
          >
            {isExtracting && <Spinner />}
            {isExtracting ? '추출 중...' : '다시 추출'}
          </button>
          <button
            type="button"
            onClick={handleSaveEdits}
            disabled={isBusy || localSlides.length === 0}
            className="nb-btn-secondary"
          >
            {bulkUpdate.isPending && <Spinner />}
            {bulkUpdate.isPending ? '저장 중...' : '변경사항 저장'}
          </button>
          <button
            type="button"
            onClick={handleDownloadXlsx}
            disabled={localSlides.length === 0}
            className="nb-btn-secondary"
          >
            XLSX 다운로드
          </button>
          <button
            type="button"
            onClick={handleComplete}
            disabled={isBusy || localSlides.length === 0 || isExtracted}
            className="nb-btn-primary"
          >
            {completeExtraction.isPending && <Spinner className="text-white" />}
            {completeExtraction.isPending ? '처리 중...' : '추출 완료'}
          </button>
        </div>
      </div>

      {isExtracting && (
        <ChunkProgressPanel
          title="PPTX 추출"
          progress={extractChunkProgress}
          hint="원본 PPTX를 슬라이드 단위로 분석한 뒤 DB에 저장합니다."
        />
      )}

      {missingNarrationSlides.length > 0 && (
        <div className="nb-alert nb-alert--warning">
          <p className="text-sm font-medium text-amber-800">
            나레이션이 없는 슬라이드 {missingNarrationSlides.length}개
          </p>
          <p className="mt-1 text-xs text-amber-700">
            슬라이드 번호: {missingNarrationSummary}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {FILTER_TYPES.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => setTypeFilter(filter.value)}
            className={`nb-filter-pill ${
              typeFilter === filter.value
                ? 'nb-filter-pill--active'
                : 'nb-filter-pill--inactive'
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
        <div className="nb-empty-state">
          <Spinner className="text-gray-400" />
          <p className="text-sm text-gray-500">슬라이드 데이터를 불러오는 중...</p>
        </div>
      ) : localSlides.length === 0 ? (
        <div className="nb-empty-state">
          <p className="text-sm text-gray-500">추출된 슬라이드가 없습니다.</p>
          <button
            type="button"
            onClick={runExtraction}
            disabled={!project.source_pptx_url}
            className="nb-link mt-3"
          >
            PPTX 추출 시작
          </button>
        </div>
      ) : (
        <div className="nb-card nb-h-scroll overflow-hidden">
          <div className="overflow-x-auto">
            <table className="nb-table">
              <thead>
                <tr>
                  <th>슬라이드번호</th>
                  <th>유형</th>
                  <th>섹션</th>
                  <th className="min-w-[240px]">화면텍스트</th>
                  <th className="min-w-[240px]">나레이션</th>
                </tr>
              </thead>
              <tbody>
                {pagedSlides.map((slide) => {
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
                        <span className="nb-badge">
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
                          className="nb-input w-full min-w-[80px] text-xs"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <textarea
                          value={formatScreenText(slide.screen_text)}
                          onChange={(e) =>
                            updateLocalSlide(slide.id, 'screen_text', e.target.value)
                          }
                          rows={3}
                          className="nb-textarea w-full text-xs"
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
          {filteredSlides.length > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
              <p className="text-xs text-gray-500">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filteredSlides.length)} /{' '}
                {filteredSlides.length}개 슬라이드
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="rounded border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  이전
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="rounded border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  다음
                </button>
              </div>
            </div>
          )}
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
