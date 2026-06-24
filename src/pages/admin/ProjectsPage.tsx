import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { StatusBadge } from '../../components/project/StatusBadge'
import { useAllProjects, useDeleteProject } from '../../hooks/useAdmin'
import { useToast } from '../../hooks/ToastProvider'
import { LANG_CONFIG } from '../../lib/lang'
import { PROJECT_STEPS, statusToStep } from '../../lib/projectStatus'
import type { ProjectStatus } from '../../types'

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

const STATUS_OPTIONS: { value: ProjectStatus | 'all'; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'uploaded', label: '업로드됨' },
  { value: 'extracted', label: '추출 완료' },
  { value: 'spelling', label: '맞춤법 검사 중' },
  { value: 'spelling_done', label: '맞춤법 완료' },
  { value: 'translating', label: '번역 중' },
  { value: 'translated', label: '번역 완료' },
  { value: 'verifying', label: '역번역 검증 중' },
  { value: 'verified', label: '역번역 완료' },
  { value: 'expert_review', label: '전문가 검증' },
  { value: 'done', label: '완료' },
]

export function ProjectsPage() {
  const { data: projects, isLoading, error } = useAllProjects()
  const deleteProject = useDeleteProject()
  const { showToast } = useToast()
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const filteredProjects = useMemo(() => {
    if (!projects) return []
    if (statusFilter === 'all') return projects
    return projects.filter((p) => p.status === statusFilter)
  }, [projects, statusFilter])

  const handleDelete = async (projectId: string, title: string) => {
    if (!window.confirm(`"${title}" 프로젝트를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
      return
    }

    setDeletingId(projectId)
    try {
      await deleteProject.mutateAsync(projectId)
      showToast('프로젝트가 삭제되었습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '삭제에 실패했습니다.', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div>
      <div className="nb-page-toolbar">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">전체 프로젝트</h2>
          <p className="mt-1 text-sm text-gray-500">모든 사용자의 번역 프로젝트 현황</p>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="statusFilter" className="text-sm text-gray-600">
            상태 필터
          </label>
          <select
            id="statusFilter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ProjectStatus | 'all')}
            className="nb-input"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading && (
        <div className="nb-empty-state">
          <p className="text-sm text-gray-500">프로젝트를 불러오는 중...</p>
        </div>
      )}

      {error && (
        <div className="nb-alert nb-alert--error">
          프로젝트 목록을 불러오지 못했습니다: {error.message}
        </div>
      )}

      {filteredProjects.length > 0 && (
        <div className="nb-card overflow-hidden">
          <table className="nb-table">
            <thead>
              <tr>
                <th>프로젝트명</th>
                <th>생성자</th>
                <th>목표 언어</th>
                <th>현재 단계</th>
                <th>상태</th>
                <th>생성일</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((project) => {
                const step = statusToStep(project.status)
                const stepLabel = PROJECT_STEPS[step - 1]?.label ?? '-'

                return (
                  <tr key={project.id}>
                    <td>
                      <Link
                        to={`/projects/${project.id}`}
                        className="font-medium hover:underline"
                        style={{ color: '#1677ff' }}
                      >
                        {project.title}
                      </Link>
                    </td>
                    <td>
                      {project.creator?.name ?? '-'}
                      {project.creator?.email && (
                        <span className="block text-xs text-gray-400">
                          {project.creator.email}
                        </span>
                      )}
                    </td>
                    <td>{LANG_CONFIG[project.target_lang]?.name ?? project.target_lang}</td>
                    <td>
                      Step {step}: {stepLabel}
                    </td>
                    <td>
                      <StatusBadge status={project.status} />
                    </td>
                    <td className="text-gray-500">{formatDate(project.created_at)}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => handleDelete(project.id, project.title)}
                        disabled={deletingId === project.id}
                        className="text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
                      >
                        {deletingId === project.id ? '삭제 중...' : '삭제'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && !error && filteredProjects.length === 0 && (
        <div className="nb-empty-state">
          <p className="text-sm text-gray-500">
            {statusFilter === 'all'
              ? '등록된 프로젝트가 없습니다.'
              : '해당 상태의 프로젝트가 없습니다.'}
          </p>
        </div>
      )}
    </div>
  )
}
