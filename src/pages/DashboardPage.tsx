import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { StatusBadge } from '../components/project/StatusBadge'
import { Spinner } from '../components/ui/Spinner'
import { useToast } from '../hooks/ToastProvider'
import { useProjects } from '../hooks/useProject'

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

const TARGET_LANG_LABELS: Record<string, string> = {
  vi: '베트남어',
  en: '영어',
  zh: '중국어(간체)',
  ja: '일본어',
  id: '인도네시아어',
}

export function DashboardPage() {
  const { data: projects, isLoading, error } = useProjects()
  const { showToast } = useToast()

  useEffect(() => {
    if (error) {
      showToast(`프로젝트 목록을 불러오지 못했습니다: ${error.message}`, 'error')
    }
  }, [error, showToast])

  return (
    <div>
      <div className="nb-page-toolbar">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">내 프로젝트</h2>
          <p className="mt-1 text-sm text-gray-500">번역 프로젝트 목록을 확인하고 관리하세요.</p>
        </div>
        <Link to="/projects/new" className="nb-btn-primary">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          새 프로젝트
        </Link>
      </div>

      {isLoading && (
        <div className="nb-empty-state">
          <Spinner className="text-gray-400" />
          <p className="text-sm text-gray-500">프로젝트를 불러오는 중...</p>
        </div>
      )}

      {!isLoading && !error && projects?.length === 0 && (
        <div className="nb-empty-state">
          <svg
            className="h-12 w-12 text-gray-300"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <p className="text-sm font-medium text-gray-900">아직 프로젝트가 없습니다</p>
          <p className="text-sm text-gray-500">PPTX 파일을 업로드하여 번역을 시작하세요.</p>
          <Link to="/projects/new" className="nb-link mt-2 inline-flex items-center gap-1">
            새 프로젝트 만들기
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      )}

      {projects && projects.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <Link key={project.id} to={`/projects/${project.id}`} className="nb-project-card">
              <div className="mb-3 flex items-start justify-between gap-2">
                <h3 className="line-clamp-2">{project.title}</h3>
                <StatusBadge status={project.status} />
              </div>

              <dl className="space-y-1 text-xs text-gray-500">
                <div className="flex justify-between">
                  <dt>목표 언어</dt>
                  <dd className="font-medium text-gray-700">
                    {TARGET_LANG_LABELS[project.target_lang] ?? project.target_lang}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>생성일</dt>
                  <dd>{formatDate(project.created_at)}</dd>
                </div>
              </dl>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
