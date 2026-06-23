import { useEffect, useMemo, useState } from 'react'
import { ProgressBar } from '../ui/ProgressBar'
import { Spinner } from '../ui/Spinner'
import { useToast } from '../../hooks/ToastProvider'
import { useSlides } from '../../hooks/useSlides'
import {
  getNarrationSpeedInfo,
  NARRATION_FIELD_KEY,
  useCompleteTranslation,
  useRunTranslation,
  useTranslations,
  useUpdateTranslation,
} from '../../hooks/useTranslation'
import { fieldKeyLabel } from '../../lib/slideFields'
import { getLangConfig } from '../../lib/lang'
import { isStepAccessible, stepPrerequisiteMessage } from '../../lib/projectStatus'
import type { Project, Translation } from '../../types'

interface TranslationStepProps {
  project: Project
}

function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(1)}초`
}

export function TranslationStep({ project }: TranslationStepProps) {
  const { showToast } = useToast()
  const { data: slides = [] } = useSlides(project.id)
  const { data: translations = [], isLoading } = useTranslations(project.id)
  const runTranslation = useRunTranslation()
  const updateTranslation = useUpdateTranslation()
  const completeTranslation = useCompleteTranslation()

  const [progress, setProgress] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const [localTexts, setLocalTexts] = useState<Record<string, string>>({})
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set())

  const accessible = isStepAccessible(3, project.status)
  const langName = getLangConfig(project.target_lang).name
  const eligibleSlides = useMemo(
    () => slides.filter((s) => s.slide_type !== 'guide'),
    [slides],
  )

  const slideMap = useMemo(() => new Map(slides.map((s) => [s.id, s])), [slides])

  const groupedTranslations = useMemo(() => {
    const groups = new Map<number, Translation[]>()
    for (const tr of translations) {
      const slide = slideMap.get(tr.slide_id)
      const slideNum = slide?.slide_num ?? 0
      const list = groups.get(slideNum) ?? []
      list.push(tr)
      groups.set(slideNum, list)
    }
    return [...groups.entries()].sort(([a], [b]) => a - b)
  }, [translations, slideMap])

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const tr of translations) {
      next[tr.id] = localTexts[tr.id] ?? tr.vi_text
    }
    setLocalTexts(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translations])

  const handleRunTranslation = async () => {
    if (!accessible) {
      showToast(stepPrerequisiteMessage(3), 'error')
      return
    }

    setIsRunning(true)
    setProgress(0)
    try {
      await runTranslation.mutateAsync({
        projectId: project.id,
        slideIds: eligibleSlides.map((s) => s.id),
        targetLang: project.target_lang,
        onProgress: setProgress,
      })
      setDirtyIds(new Set())
      showToast('번역이 완료되었습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '번역에 실패했습니다.', 'error')
    } finally {
      setIsRunning(false)
    }
  }

  const handleTextChange = (id: string, value: string) => {
    setLocalTexts((prev) => ({ ...prev, [id]: value }))
    setDirtyIds((prev) => new Set(prev).add(id))
  }

  const handleSave = async (translation: Translation) => {
    const viText = localTexts[translation.id] ?? translation.vi_text
    try {
      await updateTranslation.mutateAsync({
        id: translation.id,
        projectId: project.id,
        viText,
        targetLang: project.target_lang,
      })
      setDirtyIds((prev) => {
        const next = new Set(prev)
        next.delete(translation.id)
        return next
      })
      showToast('번역문이 저장되었습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '저장에 실패했습니다.', 'error')
    }
  }

  const handleComplete = async () => {
    if (dirtyIds.size > 0) {
      showToast('저장되지 않은 변경사항이 있습니다.', 'error')
      return
    }

    try {
      await completeTranslation.mutateAsync({ projectId: project.id })
      showToast('번역 검토가 완료되었습니다. 역번역 검증 단계로 진행할 수 있습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '완료 처리에 실패했습니다.', 'error')
    }
  }

  const isBusy =
    isRunning ||
    runTranslation.isPending ||
    updateTranslation.isPending ||
    completeTranslation.isPending

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Step 3. 번역 결과</h3>
          <p className="mt-0.5 text-sm text-gray-500">
            한국어 원문과 {langName} 번역문을 비교·편집합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleRunTranslation}
            disabled={isBusy || !accessible || eligibleSlides.length === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            {isRunning && <Spinner />}
            {isRunning ? '번역 중...' : '번역 실행'}
          </button>
          <button
            type="button"
            onClick={handleComplete}
            disabled={isBusy || translations.length === 0 || dirtyIds.size > 0}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-600 disabled:opacity-50"
          >
            {completeTranslation.isPending && <Spinner className="text-white" />}
            {completeTranslation.isPending ? '처리 중...' : '번역 완료 → 역번역 검증'}
          </button>
        </div>
      </div>

      {!accessible && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {stepPrerequisiteMessage(3)}
        </div>
      )}

      {isRunning && (
        <ProgressBar progress={progress} label={`번역 진행 중... (${progress}%)`} />
      )}

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-16">
          <Spinner className="text-gray-400" />
          <p className="text-sm text-gray-500">번역 데이터를 불러오는 중...</p>
        </div>
      ) : translations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-sm text-gray-500">번역 결과가 없습니다.</p>
          <p className="mt-1 text-xs text-gray-400">
            &quot;번역 실행&quot; 버튼을 눌러 AI 번역을 시작하세요.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedTranslations.map(([slideNum, slideTranslations]) => (
            <div
              key={slideNum}
              className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
            >
              <div className="border-b border-gray-100 bg-gray-50 px-4 py-2">
                <h4 className="text-sm font-semibold text-gray-800">슬라이드 {slideNum}</h4>
              </div>
              <div className="divide-y divide-gray-100">
                {slideTranslations.map((tr) => {
                  const isNarration = tr.field_key === NARRATION_FIELD_KEY
                  const speedInfo = isNarration
                    ? getNarrationSpeedInfo(tr, project.target_lang)
                    : null
                  const isDirty = dirtyIds.has(tr.id)

                  return (
                    <div key={tr.id} className="px-4 py-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                          {fieldKeyLabel(tr.field_key)}
                        </span>
                        {isNarration && speedInfo && (
                          <span
                            className={`text-xs ${
                              speedInfo.exceeds ? 'font-medium text-red-600' : 'text-gray-500'
                            }`}
                          >
                            발화시간: 한국어 {formatSeconds(speedInfo.koSeconds)} /{' '}
                            {speedInfo.langName} {formatSeconds(speedInfo.targetSeconds)}
                            {speedInfo.exceeds && ' ⚠ 초과'}
                          </span>
                        )}
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <p className="text-xs font-medium text-gray-500">한국어</p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">
                            {tr.ko_text}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-gray-500">{langName}</p>
                          <textarea
                            value={localTexts[tr.id] ?? tr.vi_text}
                            onChange={(e) => handleTextChange(tr.id, e.target.value)}
                            rows={3}
                            className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20"
                          />
                          {isDirty && (
                            <button
                              type="button"
                              onClick={() => handleSave(tr)}
                              disabled={isBusy}
                              className="mt-2 rounded-lg border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                              저장
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
