import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { StatusBadge } from '../../components/project/StatusBadge'
import { useAllProjects } from '../../hooks/useAdmin'
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
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all')

  const filteredProjects = useMemo(() => {
    if (!projects) return []
    if (statusFilter === 'all') return projects
    return projects.filter((p) => p.status === statusFilter)
  }, [projects, statusFilter])

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">전체 프로젝트</h2>
          <p className="mt-1 text-sm text-gray-500">
            모든 사용자의 번역 프로젝트 현황
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="statusFilter" className="text-sm text-gray-600">
            상태 필터
          </label>
          <select
            id="statusFilter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ProjectStatus | 'all')}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
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
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-gray-500">프로젝트를 불러오는 중...</p>
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          프로젝트 목록을 불러오지 못했습니다: {error.message}
        </div>
      )}

      {filteredProjects.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  프로젝트명
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  생성자
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  목표 언어
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  현재 단계
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  상태
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  생성일
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredProjects.map((project) => {
                const step = statusToStep(project.status)
                const stepLabel = PROJECT_STEPS[step - 1]?.label ?? '-'

                return (
                  <tr key={project.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm">
                      <Link
                        to={`/projects/${project.id}`}
                        className="font-medium text-accent hover:underline"
                      >
                        {project.title}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                      {project.creator?.name ?? '-'}
                      {project.creator?.email && (
                        <span className="block text-xs text-gray-400">
                          {project.creator.email}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                      {LANG_CONFIG[project.target_lang]?.name ?? project.target_lang}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                      Step {step}: {stepLabel}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      <StatusBadge status={project.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      {formatDate(project.created_at)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && !error && filteredProjects.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white px-6 py-16 text-center">
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
