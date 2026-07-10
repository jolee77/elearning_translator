import { useCallback, useEffect, useMemo, useState, startTransition } from 'react'
import {
  SLIDE_TYPE_LABELS,
  formatNarration,
  formatScreenText,
  parseNarrationInput,
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
import { useReplaceProjectPptx } from '../../hooks/useProject'
import { useToast } from '../../hooks/ToastProvider'
import { PptxFileDropzone } from './PptxFileDropzone'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { ChunkProgressPanel } from '../ui/ChunkProgressPanel'
import { Spinner } from '../ui/Spinner'
import type { ChunkProgress } from '../../lib/chunkProgress'
import type { Project } from '../../types'
import type { Slide } from '../../types'

interface ExtractionStepProps {
  project: Project
  onStepComplete?: () => void
}

export function ExtractionStep({ project, onStepComplete }: ExtractionStepProps) {
  return (
    <ErrorBoundary>
      <ExtractionStepContent project={project} onStepComplete={onStepComplete} />
    </ErrorBoundary>
  )
}

function ExtractionStepContent({ project, onStepComplete }: ExtractionStepProps) {
  const { showToast } = useToast()
  const { data: slides = [], isLoading: slidesLoading } = useSlides(project.id)
  const extractSlides = useExtractSlides()
  const bulkUpdate = useBulkUpdateSlides()
  const completeExtraction = useCompleteExtraction()
  const replacePptx = useReplaceProjectPptx()

  const [localSlides, setLocalSlides] = useState<Slide[]>([])
  const [autoExtractAttempted, setAutoExtractAttempted] = useState(false)
  const [extractProgress, setExtractProgress] = useState<ParseProgress | null>(null)
  const [showFileUpload, setShowFileUpload] = useState(false)
  const [replacementFile, setReplacementFile] = useState<File | null>(null)

  useEffect(() => {
    if (slides.length > 0) {
      startTransition(() => {
        setLocalSlides(slides)
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
      })
      showToast('PPTX 추출이 완료되었습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'PPTX 추출에 실패했습니다.', 'error')
    } finally {
      setExtractProgress(null)
    }
  }, [extractSlides, project.id, project.source_pptx_url, showToast])

  const missingNarrationSlides = useMemo(
    () => localSlides.filter((s) => !formatNarration(s.narration).trim()),
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
          return { ...slide, narration: parseNarrationInput(value, slide.narration) }
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
      onStepComplete?.()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '추출 완료 처리에 실패했습니다.', 'error')
    }
  }

  const handleDownloadXlsx = () => {
    const safeTitle = project.title.replace(/[\\/:*?"<>|]/g, '_')
    downloadExtractionXlsx(localSlides, `${safeTitle}_추출결과.xlsx`)
  }

  const handleReplacePptx = async () => {
    if (!replacementFile) {
      showToast('변경할 PPTX 파일을 선택해 주세요.', 'error')
      return
    }

    const hasWorkflowData = project.status !== 'uploaded'
    if (
      hasWorkflowData &&
      !window.confirm(
        'PPTX 파일을 변경하면 추출·번역·검증 데이터가 모두 삭제되고 처음부터 다시 시작합니다. 계속하시겠습니까?',
      )
    ) {
      return
    }

    try {
      await replacePptx.mutateAsync({
        projectId: project.id,
        pptxFile: replacementFile,
      })
      startTransition(() => {
        setLocalSlides([])
        setReplacementFile(null)
        setShowFileUpload(false)
        setAutoExtractAttempted(false)
      })
      showToast('PPTX 파일이 변경되었습니다. 새 파일로 추출을 시작합니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'PPTX 파일 변경에 실패했습니다.', 'error')
    }
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
  const isBusy = isExtracting || bulkUpdate.isPending || completeExtraction.isPending || replacePptx.isPending
  const isExtracted = project.status !== 'uploaded'

  useEffect(() => {
    if (
      !autoExtractAttempted &&
      !extractSlides.isPending &&
      !replacePptx.isPending &&
      project.source_pptx_url &&
      localSlides.length === 0 &&
      !slidesLoading
    ) {
      setAutoExtractAttempted(true)
      runExtraction()
    }
  }, [
    autoExtractAttempted,
    extractSlides.isPending,
    replacePptx.isPending,
    project.source_pptx_url,
    localSlides.length,
    slidesLoading,
    runExtraction,
  ])

  return (
    <div className="space-y-4">
      <div className="nb-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-gray-900">PPTX 파일</h4>
            <p className="mt-1 text-sm text-gray-600">
              {project.source_pptx_name ?? '업로드된 파일 없음'}
            </p>
          </div>
          {!showFileUpload && (
            <button
              type="button"
              onClick={() => {
                setShowFileUpload(true)
                setReplacementFile(null)
              }}
              disabled={isBusy}
              className="nb-btn-secondary"
            >
              파일 변경
            </button>
          )}
        </div>

        {showFileUpload && (
          <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
            <p className="text-sm text-gray-500">
              새 PPTX 파일을 선택하면 기존 추출 결과가 삭제되고 다시 추출합니다.
            </p>
            <PptxFileDropzone
              file={replacementFile}
              onFileSelect={setReplacementFile}
              onClear={() => setReplacementFile(null)}
              disabled={isBusy}
              currentFileName={project.source_pptx_name}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowFileUpload(false)
                  setReplacementFile(null)
                }}
                disabled={isBusy}
                className="nb-btn-secondary"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleReplacePptx}
                disabled={isBusy || !replacementFile}
                className="nb-btn-primary"
              >
                {replacePptx.isPending && <Spinner className="text-white" />}
                {replacePptx.isPending ? '업로드 중...' : '파일 적용 및 다시 추출'}
              </button>
            </div>
          </div>
        )}
      </div>

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
            <table className="nb-table nb-extraction-table w-full">
              <colgroup>
                <col style={{ width: '8%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '31%' }} />
                <col style={{ width: '45%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>슬라이드번호</th>
                  <th>유형</th>
                  <th className="px-2">화면번호</th>
                  <th>화면텍스트</th>
                  <th>나레이션</th>
                </tr>
              </thead>
              <tbody>
                {localSlides.map((slide) => {
                  const noNarration = !formatNarration(slide.narration).trim()
                  return (
                    <tr
                      key={slide.id}
                      className={noNarration ? 'bg-amber-50/50' : 'hover:bg-gray-50/50'}
                    >
                      <td className="whitespace-nowrap px-2 py-3 font-medium text-gray-900">
                        {slide.slide_num}
                      </td>
                      <td className="whitespace-nowrap px-2 py-3">
                        <span className="nb-badge">
                          {SLIDE_TYPE_LABELS[slide.slide_type]}
                        </span>
                      </td>
                      <td className="px-2 py-3">
                        <input
                          type="text"
                          value={slide.screen_num ?? ''}
                          onChange={(e) =>
                            updateLocalSlide(slide.id, 'screen_num', e.target.value)
                          }
                          maxLength={7}
                          className="nb-input nb-extraction-input-screen-num text-center text-xs"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <textarea
                          value={formatScreenText(slide.screen_text)}
                          onChange={(e) =>
                            updateLocalSlide(slide.id, 'screen_text', e.target.value)
                          }
                          rows={3}
                          className="nb-textarea w-full text-xs"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <textarea
                          value={formatNarration(slide.narration)}
                          onChange={(e) =>
                            updateLocalSlide(slide.id, 'narration', e.target.value)
                          }
                          rows={3}
                          placeholder={noNarration ? '나레이션 없음' : ''}
                          className={`nb-textarea w-full text-xs ${
                            noNarration ? 'border-amber-300 bg-amber-50' : ''
                          }`}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isExtracted && (
        <p className="text-sm text-emerald-600">추출이 완료되었습니다. 다음 단계로 진행할 수 있습니다.</p>
      )}
    </div>
  )
}
