interface ProgressBarProps {
  progress: number
  label?: string
  indeterminate?: boolean
}

export function ProgressBar({ progress, label, indeterminate }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, progress))

  return (
    <div className="rounded-lg bg-blue-50 px-4 py-3">
      {label && <p className="text-sm text-blue-700">{label}</p>}
      <div className={`mt-2 h-1.5 overflow-hidden rounded-full bg-blue-200 ${label ? '' : 'mt-0'}`}>
        <div
          className={`h-full rounded-full bg-accent transition-all duration-300 ${
            indeterminate ? 'w-2/3 animate-pulse' : ''
          }`}
          style={indeterminate ? undefined : { width: `${clamped}%` }}
        />
      </div>
      {!indeterminate && (
        <p className="mt-1 text-right text-xs text-blue-600">{clamped}%</p>
      )}
      {indeterminate && (
        <p className="mt-1 text-right text-xs text-blue-600">처리 중…</p>
      )}
    </div>
  )
}
