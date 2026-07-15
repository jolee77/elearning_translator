import { useCallback, useState, type DragEvent } from 'react'

/** Supabase Storage 기본 단일 파일 업로드 제한 */
export const PPTX_MAX_UPLOAD_BYTES = 50 * 1024 * 1024

export function formatFileSizeMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`
}

export function isPptxFile(file: File): boolean {
  return (
    file.name.toLowerCase().endsWith('.pptx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  )
}

export function isPptxWithinUploadLimit(file: File): boolean {
  return file.size <= PPTX_MAX_UPLOAD_BYTES
}

/** 용량 초과 시 Error를 throw — 업로드 훅/제출 직전 검사용 */
export function assertPptxUploadSize(file: File): void {
  if (!isPptxWithinUploadLimit(file)) {
    throw new Error(
      `파일 용량이 50MB를 초과합니다. (현재 ${formatFileSizeMb(file.size)})\nSupabase 업로드 제한은 50MB입니다.`,
    )
  }
}

function alertPptxTooLarge(file: File): void {
  window.alert(
    `파일 용량이 업로드 제한(50MB)을 초과합니다.\n\n선택한 파일: ${formatFileSizeMb(file.size)}\n더 작은 파일로 다시 선택해 주세요.`,
  )
}

interface PptxFileDropzoneProps {
  file: File | null
  onFileSelect: (file: File) => void
  onClear?: () => void
  disabled?: boolean
  currentFileName?: string | null
}

export function PptxFileDropzone({
  file,
  onFileSelect,
  onClear,
  disabled = false,
  currentFileName,
}: PptxFileDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false)

  const handleFile = useCallback(
    (next: File) => {
      if (!isPptxFile(next)) return false
      if (!isPptxWithinUploadLimit(next)) {
        alertPptxTooLarge(next)
        return false
      }
      onFileSelect(next)
      return true
    },
    [onFileSelect],
  )

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragging(false)
      if (disabled) return
      const dropped = e.dataTransfer.files[0]
      if (dropped) handleFile(dropped)
    },
    [disabled, handleFile],
  )

  const dropzoneClass = disabled
    ? 'nb-dropzone opacity-60'
    : isDragging
      ? 'nb-dropzone nb-dropzone--active'
      : file
        ? 'nb-dropzone nb-dropzone--ready'
        : 'nb-dropzone'

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={dropzoneClass}
    >
      {file ? (
        <>
          <svg
            className="h-10 w-10 text-emerald-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="mt-3 text-sm font-medium text-gray-900">{file.name}</p>
          <p className="mt-1 text-xs text-gray-500">{formatFileSizeMb(file.size)}</p>
          {onClear && !disabled && (
            <button
              type="button"
              onClick={onClear}
              className="mt-3 text-xs text-gray-500 hover:text-red-600"
            >
              파일 제거
            </button>
          )}
        </>
      ) : (
        <>
          <svg
            className="h-10 w-10 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          {currentFileName && (
            <p className="mt-3 text-xs text-gray-500">
              현재 파일: <span className="font-medium text-gray-700">{currentFileName}</span>
            </p>
          )}
          <p className="mt-3 text-sm font-medium text-gray-700">
            PPTX 파일을 여기에 드래그하세요
          </p>
          <p className="mt-1 text-xs text-gray-500">최대 50MB · PPTX만 가능</p>
          <p className="mt-1 text-xs text-gray-500">또는</p>
          <label className={`nb-btn-secondary mt-3 ${disabled ? '' : 'cursor-pointer'}`}>
            파일 선택
            <input
              type="file"
              accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              className="hidden"
              disabled={disabled}
              onChange={(e) => {
                const picked = e.target.files?.[0]
                if (picked) handleFile(picked)
                e.target.value = ''
              }}
            />
          </label>
        </>
      )}
    </div>
  )
}
