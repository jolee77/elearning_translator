import { useCallback, useEffect, useState, type DragEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Spinner } from '../components/ui/Spinner'
import { useToast } from '../hooks/ToastProvider'
import { useSettings } from '../hooks/useAdmin'
import { useCreateProject } from '../hooks/useProject'

const TARGET_LANGUAGES = [
  { code: 'vi', name: '베트남어' },
  { code: 'en', name: '영어' },
  { code: 'zh', name: '중국어(간체)' },
  { code: 'ja', name: '일본어' },
  { code: 'id', name: '인도네시아어' },
] as const

function isPptxFile(file: File): boolean {
  return (
    file.name.toLowerCase().endsWith('.pptx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  )
}

export function NewProjectPage() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const createProject = useCreateProject()
  const { data: settings } = useSettings()

  const [courseName, setCourseName] = useState('')
  const [episodeName, setEpisodeName] = useState('')
  const [targetLang, setTargetLang] = useState('vi')
  const [pptxFile, setPptxFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    if (settings?.default_target_lang) {
      setTargetLang(settings.default_target_lang)
    }
  }, [settings?.default_target_lang])

  const handleFile = useCallback(
    (file: File) => {
      if (!isPptxFile(file)) {
        showToast('PPTX 파일만 업로드할 수 있습니다.', 'error')
        return
      }
      setPptxFile(file)
    },
    [showToast],
  )

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    if (!pptxFile) {
      showToast('PPTX 파일을 선택해 주세요.', 'error')
      return
    }

    try {
      const project = await createProject.mutateAsync({
        courseName,
        episodeName,
        targetLang,
        pptxFile,
      })
      showToast('프로젝트가 생성되었습니다.', 'success')
      navigate(`/projects/${project.id}`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : '프로젝트 생성에 실패했습니다.', 'error')
    }
  }

  const dropzoneClass = isDragging
    ? 'nb-dropzone nb-dropzone--active'
    : pptxFile
      ? 'nb-dropzone nb-dropzone--ready'
      : 'nb-dropzone'

  return (
    <div className="mx-auto max-w-2xl">
      <div className="nb-page-toolbar">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">새 프로젝트</h2>
          <p className="mt-1 text-sm text-gray-500">
            스토리보드 PPTX를 업로드하여 번역 프로젝트를 시작합니다.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="nb-card nb-input-surface p-6">
          <h3 className="mb-4 text-sm font-semibold" style={{ color: '#0958d9' }}>
            프로젝트 정보
          </h3>

          <div className="space-y-4">
            <div>
              <label htmlFor="courseName" className="nb-field-label">
                과정명
              </label>
              <input
                id="courseName"
                type="text"
                required
                value={courseName}
                onChange={(e) => setCourseName(e.target.value)}
                className="nb-input mt-1 w-full"
                placeholder="예: PLC 기초과정"
              />
            </div>

            <div>
              <label htmlFor="episodeName" className="nb-field-label">
                회차명
              </label>
              <input
                id="episodeName"
                type="text"
                required
                value={episodeName}
                onChange={(e) => setEpisodeName(e.target.value)}
                className="nb-input mt-1 w-full"
                placeholder="예: 1회차 - 시스템 개요"
              />
            </div>

            <div>
              <label htmlFor="targetLang" className="nb-field-label">
                목표 언어
              </label>
              <select
                id="targetLang"
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                className="nb-input mt-1 w-full"
              >
                {TARGET_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="nb-card p-6">
          <h3 className="nb-step-title mb-4">PPTX 파일</h3>

          <div
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={dropzoneClass}
          >
            {pptxFile ? (
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
                <p className="mt-3 text-sm font-medium text-gray-900">{pptxFile.name}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {(pptxFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
                <button
                  type="button"
                  onClick={() => setPptxFile(null)}
                  className="mt-3 text-xs text-gray-500 hover:text-red-600"
                >
                  파일 제거
                </button>
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
                <p className="mt-3 text-sm font-medium text-gray-700">
                  PPTX 파일을 여기에 드래그하세요
                </p>
                <p className="mt-1 text-xs text-gray-500">또는</p>
                <label className="nb-btn-secondary mt-3 cursor-pointer">
                  파일 선택
                  <input
                    type="file"
                    accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleFile(file)
                    }}
                  />
                </label>
              </>
            )}
          </div>
        </div>

        {createProject.isPending && (
          <div className="nb-alert nb-alert--warning">
            <div className="mb-2 flex items-center gap-2">
              <Spinner />
              <span>업로드 중...</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#ffe58f]">
              <div className="h-full w-full animate-pulse rounded-full bg-[#1677ff]" />
            </div>
          </div>
        )}

        <div className="nb-form-actions">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            disabled={createProject.isPending}
            className="nb-btn-secondary"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={createProject.isPending || !pptxFile}
            className="nb-btn-primary"
          >
            {createProject.isPending && <Spinner className="text-white" />}
            {createProject.isPending ? '업로드 중...' : '프로젝트 생성'}
          </button>
        </div>
      </form>
    </div>
  )
}
