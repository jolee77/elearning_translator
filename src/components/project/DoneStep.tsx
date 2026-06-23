import { useState } from 'react'
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
import { useToast } from '../../hooks/ToastProvider'
import { useTranslations } from '../../hooks/useTranslation'
import { generateVnPptx } from '../../lib/pptxGenerator'
import { supabase } from '../../lib/supabase'
import { downloadBlob, generateTranslationXlsx } from '../../lib/xlsxGenerator'
import { Spinner } from '../ui/Spinner'
import type { ChangeLog, ChangeLogAction, Project } from '../../types'

interface DoneStepProps {
  project: Project
}

const ACTION_LABELS: Record<ChangeLogAction, string> = {
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

function safeFilename(title: string): string {
  return title.replace(/[<>:"/\\|?*]/g, '_').trim() || 'project'
}

async function fetchAllChangeLogs(projectId: string): Promise<ChangeLog[]> {
  const { data, error } = await supabase
    .from('change_logs')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data
}

async function downloadSourcePptx(storagePath: string): Promise<File> {
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(storagePath)
  if (error) throw error
  return new File([await data.arrayBuffer()], 'source.pptx', {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  })
}

export function DoneStep({ project }: DoneStepProps) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const { data: reviews = [] } = useExpertReviews(project.id)
  const completedReview = reviews.find((r) => r.status === 'done') ?? reviews[0]
  const { data: items = [] } = useExpertReviewItems(completedReview?.id)
  const { data: changeLogs = [], isLoading } = useChangeLogs(project.id)
  const { data: slides = [] } = useSlides(project.id)
  const { data: translations = [] } = useTranslations(project.id)

  const [downloading, setDownloading] = useState<'pptx' | 'xlsx' | 'zip' | null>(null)

  const stats = getExpertReviewStats(items)
  const baseName = safeFilename(project.title)

  const logDownload = async (detail: string) => {
    if (!user) return
    await supabase.from('change_logs').insert({
      project_id: project.id,
      user_id: user.id,
      action: 'download',
      detail,
    })
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
      const blob = await generateVnPptx(sourceFile, translations)
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
      const allChangeLogs = await fetchAllChangeLogs(project.id)
      const blob = generateTranslationXlsx(project, slides, translations, allChangeLogs)
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
      const [sourceFile, allChangeLogs] = await Promise.all([
        downloadSourcePptx(project.source_pptx_url),
        fetchAllChangeLogs(project.id),
      ])

      const [pptxBlob, xlsxBlob] = await Promise.all([
        generateVnPptx(sourceFile, translations),
        Promise.resolve(generateTranslationXlsx(project, slides, translations, allChangeLogs)),
      ])

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

  const isBusy = downloading !== null
  const isProjectDone = project.status === 'done'

  if (!isProjectDone) {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Step 6. 완료</h3>
          <p className="mt-0.5 text-sm text-gray-500">
            전문가 검증이 완료되면 산출물을 다운로드할 수 있습니다.
          </p>
        </div>
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
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
        <h3 className="text-base font-semibold text-gray-900">Step 6. 완료</h3>
        <p className="mt-0.5 text-sm text-gray-500">
          전문가 검증이 완료되었습니다. 산출물을 다운로드할 수 있습니다.
        </p>
      </div>

      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
        <div className="flex items-center gap-2">
          <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-sm font-semibold text-emerald-800">프로젝트가 완료되었습니다.</p>
        </div>
        {completedReview?.reviewer_name && (
          <p className="mt-1 text-sm text-emerald-700">
            검증 전문가: {completedReview.reviewer_name}
            {completedReview.reviewer_email && ` (${completedReview.reviewer_email})`}
          </p>
        )}
      </div>

      {items.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-4">
          <h4 className="text-sm font-semibold text-gray-800">전문가 검토 통계</h4>
          <div className="mt-3 flex flex-wrap gap-4">
            <div className="rounded-lg bg-emerald-50 px-4 py-2">
              <p className="text-xs text-emerald-600">승인</p>
              <p className="text-lg font-semibold text-emerald-800">{stats.approved}건</p>
            </div>
            <div className="rounded-lg bg-amber-50 px-4 py-2">
              <p className="text-xs text-amber-600">수정</p>
              <p className="text-lg font-semibold text-amber-800">{stats.modified}건</p>
            </div>
            <div className="rounded-lg bg-gray-50 px-4 py-2">
              <p className="text-xs text-gray-500">전체</p>
              <p className="text-lg font-semibold text-gray-800">{stats.total}건</p>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white px-4 py-4">
        <h4 className="text-sm font-semibold text-gray-800">변경 이력</h4>
        {isLoading ? (
          <p className="mt-3 text-sm text-gray-500">변경 이력을 불러오는 중...</p>
        ) : changeLogs.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">변경 이력이 없습니다.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100">
            {changeLogs.map((log) => (
              <li key={log.id} className="py-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                      {ACTION_LABELS[log.action] ?? log.action}
                    </span>
                    {log.detail && (
                      <p className="mt-1 text-sm text-gray-800">{log.detail}</p>
                    )}
                  </div>
                  <time className="text-xs text-gray-400">
                    {new Date(log.created_at).toLocaleString('ko-KR')}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-4">
        <h4 className="text-sm font-semibold text-gray-800">산출물 다운로드</h4>
        <p className="mt-1 text-xs text-gray-500">
          VN 스토리보드(PPTX), 번역 결과(엑셀), 전체 산출물(ZIP)을 다운로드할 수 있습니다.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isBusy || !project.source_pptx_url || translations.length === 0}
            onClick={handleDownloadPptx}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
          >
            {downloading === 'pptx' && <Spinner />}
            {downloading === 'pptx' ? '생성 중...' : 'VN 스토리보드 다운로드 (PPTX)'}
          </button>
          <button
            type="button"
            disabled={isBusy || slides.length === 0 || translations.length === 0}
            onClick={handleDownloadXlsx}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
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
            className="inline-flex items-center gap-2 rounded-lg bg-[#162B52] px-4 py-2 text-sm font-medium text-white hover:bg-[#1e3a6e] disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {downloading === 'zip' && <Spinner className="text-white" />}
            {downloading === 'zip' ? '생성 중...' : '변경이력 포함 전체 다운로드 (ZIP)'}
          </button>
        </div>
      </div>
    </div>
  )
}
