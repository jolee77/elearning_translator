import { useMemo, useState } from 'react'
import JSZip from 'jszip'
import {
  getExpertReviewStats,
  useChangeLogs,
  useExpertReviewItems,
  useExpertReviews,
} from '../../hooks/useExpertReview'
import { useAuth } from '../../hooks/useAuth'
import { STORAGE_BUCKET } from '../../hooks/useProject'
import { useSlides } from '../../hooks/useSlides'
import { useSpellingResults } from '../../hooks/useSpelling'
import { useToast } from '../../hooks/ToastProvider'
import { useTranslations } from '../../hooks/useTranslation'
import { generateVnPptx } from '../../lib/pptxGenerator'
import { isEventChangeLog } from '../../lib/textChangeSummary'
import { supabase } from '../../lib/supabase'
import { downloadBlob, downloadExtractionXlsx, generateTranslationXlsx, type XlsxActorContext } from '../../lib/xlsxGenerator'
import { Spinner } from '../ui/Spinner'
import { TextChangeSummaryPanel } from './TextChangeSummaryPanel'
import type { ChangeLog, ChangeLogAction, Project } from '../../types'

interface DoneStepProps {
  project: Project
}

const ACTION_LABELS: Record<ChangeLogAction, string> = {
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
  download: '다운로드',
}

function safeFilename(title: string): string {
  return title.replace(/[<>:"/\\|?*]/g, '_').trim() || 'project'
}

async function fetchAllChangeLogs(projectId: string): Promise<ChangeLog[]> {
  const { data, error } = await supabase
    .from('change_logs')
    .select('*')
    .eq('project_id', projectId)
    .order('changed_at', { ascending: true })

  if (error) throw error
  return data
}

async function fetchXlsxActors(
  changeLogs: ChangeLog[],
  expertName?: string | null,
): Promise<XlsxActorContext> {
  const userIds = [
    ...new Set(
      changeLogs
        .map((log) => log.user_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ]

  const profileNames: Record<string, string> = {}
  if (userIds.length > 0) {
    const { data, error } = await supabase.from('profiles').select('id, name').in('id', userIds)
    if (error) throw error
    for (const profile of data ?? []) {
      if (profile.name?.trim()) {
        profileNames[profile.id] = profile.name.trim()
      }
    }
  }

  return { profileNames, expertName: expertName?.trim() || null }
}

async function downloadSourcePptx(storagePath: string): Promise<File> {
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(storagePath)
  if (error) {
    throw new Error(`원본 PPTX를 불러오지 못했습니다: ${error.message}`)
  }
  if (!data) {
    throw new Error('원본 PPTX 파일이 비어 있습니다.')
  }
  return new File([await data.arrayBuffer()], 'source.pptx', {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  })
}

export function DoneStep({ project }: DoneStepProps) {
  const { user, profile } = useAuth()
  const { showToast } = useToast()
  const { data: reviews = [] } = useExpertReviews(project.id)
  const completedReview = reviews.find((r) => r.status === 'done') ?? reviews[0]
  const { data: items = [] } = useExpertReviewItems(completedReview?.id, project.id)
  const { data: changeLogs = [], isLoading } = useChangeLogs(project.id)
  const { data: slides = [] } = useSlides(project.id)
  const { data: translations = [] } = useTranslations(project.id)
  const { data: spellingResults = [] } = useSpellingResults(project.id)

  const [downloading, setDownloading] = useState<'pptx' | 'xlsx' | 'zip' | 'extract' | null>(null)

  const stats = getExpertReviewStats(items)
  const baseName = safeFilename(project.title)
  const slideNumById = useMemo(
    () => new Map(slides.map((s) => [s.id, s.slide_num])),
    [slides],
  )
  const eventLogs = useMemo(() => changeLogs.filter(isEventChangeLog), [changeLogs])

  const logDownload = async (detail: string) => {
    if (!user) return
    await supabase.from('change_logs').insert({
      project_id: project.id,
      user_id: user.id,
      changed_by: profile?.name?.trim() || null,
      action: 'download',
      detail,
    })
  }

  const buildXlsxBlob = async () => {
    const allChangeLogs = await fetchAllChangeLogs(project.id)
    const actors = await fetchXlsxActors(allChangeLogs, completedReview?.expert_name)
    return generateTranslationXlsx(project, slides, translations, allChangeLogs, actors)
  }

  const handleDownloadPptx = async () => {
    if (!project.source_pptx_url) {
      showToast('원본 PPTX 파일을 찾을 수 없습니다.', 'error')
      return
    }
    if (translations.length === 0) {
      showToast('번역 데이터가 없습니다.', 'error')
      return
    }

    setDownloading('pptx')
    try {
      const sourceFile = await downloadSourcePptx(project.source_pptx_url)
      const blob = await generateVnPptx(sourceFile, translations, {
        spellingResults,
      })
      if (blob.size === 0) {
        throw new Error('생성된 PPTX 파일이 비어 있습니다.')
      }
      downloadBlob(blob, `${baseName}_VN.pptx`)
      await logDownload('VN 스토리보드 PPTX 다운로드')
      showToast('VN PPTX 다운로드가 완료되었습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'PPTX 생성에 실패했습니다.', 'error')
    } finally {
      setDownloading(null)
    }
  }

  const handleDownloadXlsx = async () => {
    if (slides.length === 0 || translations.length === 0) {
      showToast('슬라이드 또는 번역 데이터가 없습니다.', 'error')
      return
    }

    setDownloading('xlsx')
    try {
      const blob = await buildXlsxBlob()
      downloadBlob(blob, `${baseName}_번역결과.xlsx`)
      await logDownload('번역 결과 XLSX 다운로드')
      showToast('엑셀 다운로드가 완료되었습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '엑셀 생성에 실패했습니다.', 'error')
    } finally {
      setDownloading(null)
    }
  }

  const handleDownloadZip = async () => {
    if (!project.source_pptx_url) {
      showToast('원본 PPTX 파일을 찾을 수 없습니다.', 'error')
      return
    }
    if (slides.length === 0 || translations.length === 0) {
      showToast('슬라이드 또는 번역 데이터가 없습니다.', 'error')
      return
    }

    setDownloading('zip')
    try {
      const [sourceFile, xlsxBlob] = await Promise.all([
        downloadSourcePptx(project.source_pptx_url),
        buildXlsxBlob(),
      ])

      const pptxBlob = await generateVnPptx(sourceFile, translations, {
        spellingResults,
      })
      if (pptxBlob.size === 0) {
        throw new Error('생성된 PPTX 파일이 비어 있습니다.')
      }

      const zip = new JSZip()
      zip.file(`${baseName}_VN.pptx`, pptxBlob)
      zip.file(`${baseName}_번역결과.xlsx`, xlsxBlob)

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      downloadBlob(zipBlob, `${baseName}_산출물.zip`)
      await logDownload('변경이력 포함 전체 산출물 ZIP 다운로드')
      showToast('전체 산출물 다운로드가 완료되었습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'ZIP 생성에 실패했습니다.', 'error')
    } finally {
      setDownloading(null)
    }
  }

  const handleDownloadExtractionOnly = () => {
    if (slides.length === 0) {
      showToast('슬라이드 데이터가 없습니다.', 'error')
      return
    }
    setDownloading('extract')
    try {
      downloadExtractionXlsx(slides, `${baseName}_추출결과.xlsx`)
      showToast('추출 결과 다운로드가 완료되었습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '엑셀 생성에 실패했습니다.', 'error')
    } finally {
      setDownloading(null)
    }
  }

  const isBusy = downloading !== null
  const isProjectDone = project.status === 'done'

  if (!isProjectDone) {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="nb-step-title">Step 6. 완료</h3>
          <p className="nb-step-desc">
            전문가 검증이 완료되면 산출물을 다운로드할 수 있습니다.
          </p>
        </div>
        <div className="nb-empty-state">
          <p className="text-sm text-gray-500">아직 프로젝트가 완료되지 않았습니다.</p>
          <p className="mt-1 text-xs text-gray-400">
            전문가 검증이 완료되면 이 단계에서 산출물을 다운로드할 수 있습니다.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="nb-step-title">Step 6. 완료</h3>
        <p className="nb-step-desc">
          전문가 검증이 완료되었습니다. 산출물을 다운로드할 수 있습니다.
        </p>
      </div>

      <div className="nb-alert nb-alert--success">
        <div className="flex items-center gap-2">
          <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-sm font-semibold text-emerald-800">프로젝트가 완료되었습니다.</p>
        </div>
        {completedReview?.expert_name && (
          <p className="mt-1 text-sm text-emerald-700">
            검증 전문가: {completedReview.expert_name}
            {completedReview.expert_email && ` (${completedReview.expert_email})`}
          </p>
        )}
      </div>

      {items.length > 0 && (
        <div className="nb-card px-4 py-4">
          <h4 className="text-sm font-semibold text-gray-800">전문가 검토 통계</h4>
          <div className="mt-3 flex flex-wrap gap-4">
            <div className="rounded-lg bg-emerald-50 px-4 py-2">
              <p className="text-xs text-emerald-600">검토 완료</p>
              <p className="text-lg font-semibold text-emerald-800">{stats.reviewed}건</p>
            </div>
            <div className="rounded-lg bg-amber-50 px-4 py-2">
              <p className="text-xs text-amber-600">번역 수정</p>
              <p className="text-lg font-semibold text-amber-800">{stats.changed}건</p>
            </div>
            <div className="rounded-lg bg-gray-50 px-4 py-2">
              <p className="text-xs text-gray-500">전체</p>
              <p className="text-lg font-semibold text-gray-800">{stats.total}건</p>
            </div>
          </div>
        </div>
      )}

      <TextChangeSummaryPanel
        spellingResults={spellingResults}
        expertItems={items}
        changeLogs={changeLogs}
        slideNumById={slideNumById}
      />

      <div className="nb-card px-4 py-4">
        <h4 className="text-sm font-semibold text-gray-800">변경 이력</h4>
        <p className="mt-1 text-xs text-gray-400">단계 완료·다운로드 등 이벤트 타임라인</p>
        {isLoading ? (
          <p className="mt-3 text-sm text-gray-500">변경 이력을 불러오는 중...</p>
        ) : eventLogs.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">변경 이력이 없습니다.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100">
            {eventLogs.map((log) => (
              <li key={log.id} className="py-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                      {(log.action && ACTION_LABELS[log.action]) || log.action}
                    </span>
                    {log.detail && (
                      <p className="mt-1 text-sm text-gray-800">{log.detail}</p>
                    )}
                  </div>
                  <time className="text-xs text-gray-400">
                    {new Date(log.changed_at).toLocaleString('ko-KR')}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="nb-card nb-input-surface px-4 py-4">
        <h4 className="text-sm font-semibold text-gray-800">산출물 다운로드</h4>
        <p className="mt-1 text-xs text-gray-500">
          VN 스토리보드(PPTX), 번역 결과(엑셀), 전체 산출물(ZIP)을 다운로드할 수 있습니다.
        </p>
        {translations.length === 0 && (
          <div className="nb-alert nb-alert--warning mt-3">
            <p className="text-sm font-medium">번역 데이터가 없어 VN·번역 산출물을 만들 수 없습니다.</p>
            <p className="mt-1 text-xs">
              재추출 등으로 번역·역번역이 삭제된 경우입니다. Step 3에서 번역·역번역을 다시 실행한 뒤
              이용해 주세요.
            </p>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isBusy || !project.source_pptx_url || translations.length === 0}
            onClick={handleDownloadPptx}
            className="nb-btn-secondary"
            title={
              translations.length === 0
                ? '번역 데이터가 필요합니다'
                : !project.source_pptx_url
                  ? '원본 PPTX가 없습니다'
                  : undefined
            }
          >
            {downloading === 'pptx' && <Spinner />}
            {downloading === 'pptx' ? '생성 중...' : 'VN 스토리보드 다운로드 (PPTX)'}
          </button>
          <button
            type="button"
            disabled={isBusy || slides.length === 0 || translations.length === 0}
            onClick={handleDownloadXlsx}
            className="nb-btn-secondary"
            title={
              translations.length === 0
                ? '번역 데이터가 필요합니다'
                : slides.length === 0
                  ? '슬라이드 데이터가 없습니다'
                  : undefined
            }
          >
            {downloading === 'xlsx' && <Spinner />}
            {downloading === 'xlsx' ? '생성 중...' : '번역 결과 다운로드 (XLSX)'}
          </button>
          <button
            type="button"
            disabled={
              isBusy ||
              !project.source_pptx_url ||
              slides.length === 0 ||
              translations.length === 0
            }
            onClick={handleDownloadZip}
            className="nb-btn-primary"
            title={
              translations.length === 0
                ? '번역 데이터가 필요합니다'
                : undefined
            }
          >
            {downloading === 'zip' && <Spinner className="text-white" />}
            {downloading === 'zip' ? '생성 중...' : '변경이력 포함 전체 다운로드 (ZIP)'}
          </button>
        </div>
        {slides.length > 0 && translations.length === 0 && (
          <div className="mt-3 border-t border-gray-100 pt-3">
            <p className="text-xs text-gray-500">번역 없이도 받을 수 있는 파일</p>
            <button
              type="button"
              disabled={isBusy}
              onClick={handleDownloadExtractionOnly}
              className="nb-btn-secondary mt-2"
            >
              {downloading === 'extract' && <Spinner />}
              {downloading === 'extract' ? '생성 중...' : '추출 결과만 다운로드 (XLSX)'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
