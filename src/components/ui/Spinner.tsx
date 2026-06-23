interface SpinnerProps {
  className?: string
  size?: 'sm' | 'md'
}

const sizeClass = {
  sm: 'h-3.5 w-3.5 border-2',
  md: 'h-4 w-4 border-2',
} as const

export function Spinner({ className = '', size = 'sm' }: SpinnerProps) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-current border-t-transparent ${sizeClass[size]} ${className}`}
      role="status"
      aria-label="로딩 중"
    />
  )
}
