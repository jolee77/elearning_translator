import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { PptxFileDropzone, isPptxFile } from '../components/project/PptxFileDropzone'
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

export function NewProjectPage() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const createProject = useCreateProject()
  const { data: settings } = useSettings()

  const [courseName, setCourseName] = useState('')
  const [episodeName, setEpisodeName] = useState('')
  const [targetLang, setTargetLang] = useState('vi')
  const [pptxFile, setPptxFile] = useState<File | null>(null)

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

          <PptxFileDropzone
            file={pptxFile}
            onFileSelect={handleFile}
            onClear={() => setPptxFile(null)}
            disabled={createProject.isPending}
          />
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
