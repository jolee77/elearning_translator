import { useEffect, useState, type FormEvent } from 'react'
import { maskApiKey } from '../../lib/apiKey'
import { LANG_CONFIG } from '../../lib/lang'
import { useSettings, useUpdateSettings } from '../../hooks/useAdmin'
import { useToast } from '../../hooks/ToastProvider'
import { Spinner } from '../../components/ui/Spinner'

const TARGET_LANGUAGES = Object.entries(LANG_CONFIG).map(([code, { name }]) => ({
  code,
  name,
}))

export function SettingsPage() {
  const { data: settings, isLoading, error } = useSettings()
  const updateSettings = useUpdateSettings()
  const { showToast } = useToast()

  const [apiKeyInput, setApiKeyInput] = useState('')
  const [defaultTargetLang, setDefaultTargetLang] = useState('vi')

  useEffect(() => {
    if (settings) {
      setDefaultTargetLang(settings.default_target_lang || 'vi')
    }
  }, [settings])

  const maskedKey = maskApiKey(settings?.claude_api_key)
  const hasExistingKey = !!settings?.claude_api_key

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    try {
      await updateSettings.mutateAsync({
        claudeApiKey: apiKeyInput || undefined,
        defaultTargetLang,
      })
      setApiKeyInput('')
      showToast('설정이 저장되었습니다.', 'success')
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : '설정 저장에 실패했습니다.',
        'error',
      )
    }
  }

  if (isLoading) {
    return (
      <div className="nb-empty-state">
        <Spinner className="text-gray-400" />
        <p className="text-sm text-gray-500">설정을 불러오는 중...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="nb-alert nb-alert--error">
        설정을 불러오지 못했습니다: {error.message}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="nb-page-toolbar">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">API 설정</h2>
          <p className="mt-1 text-sm text-gray-500">
            Claude API 키와 목표 언어 기본값을 관리합니다.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="nb-card nb-input-surface p-6">
          <h3 className="mb-4 text-sm font-semibold" style={{ color: '#0958d9' }}>
            Claude API 키
          </h3>

          {hasExistingKey && (
            <div className="nb-input-panel mb-4">
              <p className="text-xs font-medium text-gray-500">현재 등록된 키</p>
              <p className="mt-1 font-mono text-sm text-gray-800">{maskedKey}</p>
            </div>
          )}

          <div>
            <label htmlFor="apiKey" className="nb-field-label">
              {hasExistingKey ? '새 API 키 (변경 시에만 입력)' : 'API 키'}
            </label>
            <input
              id="apiKey"
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              className="nb-input mt-1 w-full font-mono"
              placeholder="sk-ant-api03-..."
              autoComplete="off"
            />
            <p className="nb-help-text">
              Edge Function에서 사용됩니다. 서버에만 저장되며 화면에는 마스킹되어 표시됩니다.
            </p>
          </div>
        </div>

        <div className="nb-card nb-input-surface p-6">
          <h3 className="mb-4 text-sm font-semibold" style={{ color: '#0958d9' }}>
            목표 언어 기본값
          </h3>

          <div>
            <label htmlFor="defaultLang" className="nb-field-label">
              기본 목표 언어
            </label>
            <select
              id="defaultLang"
              value={defaultTargetLang}
              onChange={(e) => setDefaultTargetLang(e.target.value)}
              className="nb-input mt-1 w-full"
            >
              {TARGET_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
            <p className="nb-help-text">
              새 프로젝트 생성 시 기본으로 선택되는 목표 언어입니다.
            </p>
          </div>
        </div>

        <div className="nb-form-actions">
          <button type="submit" disabled={updateSettings.isPending} className="nb-btn-primary">
            {updateSettings.isPending ? '저장 중...' : '저장'}
          </button>
        </div>
      </form>
    </div>
  )
}
