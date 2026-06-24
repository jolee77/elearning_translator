import type { ChunkProgress } from '../../lib/chunkProgress'
import { ProgressBar } from './ProgressBar'

interface ChunkProgressPanelProps {
  title: string
  progress: ChunkProgress | null
  hint?: string
}

export function ChunkProgressPanel({ title, progress, hint }: ChunkProgressPanelProps) {
  if (!progress) return null

  const batchLabel =
    progress.total > 1
      ? `${progress.phase} (${progress.current}/${progress.total}묶음)`
      : progress.phase

  return (
    <div className="space-y-1">
      <ProgressBar
        progress={progress.percent}
        indeterminate={progress.percent > 0 && progress.percent < 100 && progress.current < 1}
        label={`${title} — ${batchLabel}`}
      />
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  )
}
