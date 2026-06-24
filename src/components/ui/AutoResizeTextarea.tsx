import { useEffect, useRef, type TextareaHTMLAttributes } from 'react'

interface AutoResizeTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  minRows?: number
}

export function AutoResizeTextarea({
  minRows = 2,
  value,
  className = '',
  ...props
}: AutoResizeTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const lineHeight = parseInt(getComputedStyle(el).lineHeight, 10) || 20
    const minHeight = lineHeight * minRows + 16
    el.style.height = `${Math.max(el.scrollHeight, minHeight)}px`
  }, [value, minRows])

  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      className={`resize-none overflow-hidden ${className}`}
      {...props}
    />
  )
}
