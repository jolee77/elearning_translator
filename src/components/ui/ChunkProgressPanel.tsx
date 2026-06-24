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

  const waitingForFirstBatch = progress.total > 0 && progress.current === 0

  return (
    <div className="space-y-1">
      <ProgressBar
        progress={progress.percent}
        indeterminate={waitingForFirstBatch}
        label={`${title} — ${batchLabel}`}
      />
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  )
}
