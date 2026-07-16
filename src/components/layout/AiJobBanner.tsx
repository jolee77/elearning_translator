import { Link } from 'react-router-dom'
import { AI_JOB_LABELS } from '../../lib/aiJobs'
import { useAiJobs } from '../../hooks/AiJobProvider'

export function AiJobBanner() {
  const { runningJobs } = useAiJobs()

  if (runningJobs.length === 0) return null

  return (
    <div className="border-b border-accent/20 bg-accent/5 px-4 py-2 sm:px-6">
      <ul className="space-y-1.5">
        {runningJobs.map((job) => {
          const progress = job.progress
          const detail = progress
            ? progress.total > 1
              ? `${progress.current}/${progress.total}묶음 (${progress.percent}%)`
              : `${progress.phase} (${progress.percent}%)`
            : '준비 중'
          return (
            <li key={job.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-medium text-accent">
                「{job.projectTitle}」 {AI_JOB_LABELS[job.kind]} 중
              </span>
              <span className="text-gray-600">{detail}</span>
              <Link
                to={`/projects/${job.projectId}`}
                className="nb-link text-xs font-medium"
              >
                프로젝트로 이동
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
