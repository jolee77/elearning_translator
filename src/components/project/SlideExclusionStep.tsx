import { useEffect, useMemo, useState } from 'react'
import {
  SLIDE_TYPE_LABELS,
  formatNarration,
  formatScreenText,
} from '../../lib/pptxParser'
import { isStepAccessible, stepPrerequisiteMessage } from '../../lib/projectStatus'
import {
  useCompleteSlideSelection,
  useSaveSlideExclusions,
  useSlides,
} from '../../hooks/useSlides'
import { useToast } from '../../hooks/ToastProvider'
import { Spinner } from '../ui/Spinner'
import type { Project, Slide, SlideType } from '../../types'

interface SlideExclusionStepProps {
  project: Project
  onStepComplete?: () => void
}

type FilterMode = 'all' | 'include' | 'exclude'

const QUICK_EXCLUDE_TYPES: SlideType[] = ['intro', 'divider', 'outro']

export function SlideExclusionStep({ project, onStepComplete }: SlideExclusionStepProps) {
  const { showToast } = useToast()
  const { data: slides = [], isLoading } = useSlides(project.id)
  const saveExclusions = useSaveSlideExclusions()
  const completeSelection = useCompleteSlideSelection()

  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<FilterMode>('all')
  const [initialized, setInitialized] = useState(false)

  const accessible = isStepAccessible(3, project.status)
  const selectionDone =
    project.status === 'selection_done' ||
    ['translating', 'translated', 'verifying', 'verified', 'expert_review', 'done'].includes(
      project.status,
    )
  const canEdit = accessible && !['translating', 'translated', 'verifying', 'verified', 'expert_review', 'done'].includes(
    project.status,
  )

  useEffect(() => {
    if (slides.length === 0) return
    const next = new Set<string>()
    for (const slide of slides) {
      if (slide.exclude_from_translation || slide.slide_type === 'guide') {
        next.add(slide.id)
      }
    }
    setExcludedIds(next)
    setInitialized(true)
  }, [slides])

  const stats = useMemo(() => {
    let included = 0
    let excluded = 0
    let emptyText = 0
    for (const slide of slides) {
      const isExcluded = excludedIds.has(slide.id) || slide.slide_type === 'guide'
      if (isExcluded) {
        excluded += 1
      } else {
        included += 1
        const hasText =
          formatScreenText(slide.screen_text).trim() || formatNarration(slide.narration).trim()
        if (!hasText) emptyText += 1
      }
    }
    return { included, excluded, emptyText, total: slides.length }
  }, [slides, excludedIds])

  const filteredSlides = useMemo(() => {
    return slides.filter((slide) => {
      const isExcluded = excludedIds.has(slide.id)
      if (filter === 'include') return !isExcluded
      if (filter === 'exclude') return isExcluded
      return true
    })
  }, [slides, excludedIds, filter])

  const toggleExclude = (slide: Slide) => {
    if (!canEdit || slide.slide_type === 'guide') return
    setExcludedIds((prev) => {
      const next = new Set(prev)
      if (next.has(slide.id)) next.delete(slide.id)
      else next.add(slide.id)
      return next
    })
  }

  const setAll = (exclude: boolean) => {
    if (!canEdit) return
    if (exclude) {
      setExcludedIds(new Set(slides.map((s) => s.id)))
      return
    }
    setExcludedIds(new Set(slides.filter((s) => s.slide_type === 'guide').map((s) => s.id)))
  }

  const excludeByTypes = (types: SlideType[]) => {
    if (!canEdit) return
    setExcludedIds((prev) => {
      const next = new Set(prev)
      for (const slide of slides) {
        if (types.includes(slide.slide_type) || slide.slide_type === 'guide') {
          next.add(slide.id)
        }
      }
      return next
    })
  }

  const excludeEmpty = () => {
    if (!canEdit) return
    setExcludedIds((prev) => {
      const next = new Set(prev)
      for (const slide of slides) {
        const hasText =
          formatScreenText(slide.screen_text).trim() || formatNarration(slide.narration).trim()
        if (!hasText || slide.slide_type === 'guide') next.add(slide.id)
      }
      return next
    })
  }

  const buildExclusions = () =>
    slides.map((slide) => ({
      id: slide.id,
      exclude_from_translation: slide.slide_type === 'guide' || excludedIds.has(slide.id),
    }))

  const handleSave = async () => {
    if (!canEdit) return
    try {
      await saveExclusions.mutateAsync({
        projectId: project.id,
        exclusions: buildExclusions(),
      })
      showToast('제외 설정이 저장되었습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '저장에 실패했습니다.', 'error')
    }
  }

  const handleComplete = async () => {
    if (!accessible) {
      showToast(stepPrerequisiteMessage(3), 'error')
      return
    }
    if (stats.included === 0) {
      showToast('번역에 포함할 슬라이드가 최소 1개 필요합니다.', 'error')
      return
    }
    try {
      await completeSelection.mutateAsync({
        projectId: project.id,
        exclusions: buildExclusions(),
        includedCount: stats.included,
        excludedCount: stats.excluded,
      })
      showToast('번역 대상 선택이 완료되었습니다.', 'success')
      onStepComplete?.()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '선택 완료 처리에 실패했습니다.', 'error')
    }
  }

  const isBusy = saveExclusions.isPending || completeSelection.isPending

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">번역 대상 선택</h3>
          <p className="mt-1 text-sm text-gray-500">
            추출된 내용을 확인한 뒤, 번역에서 제외할 슬라이드를 선택하세요. 제외된 슬라이드는
            번역·역번역·산출물에 포함되지 않습니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <button
              type="button"
              onClick={handleSave}
              disabled={isBusy || !initialized}
              className="nb-btn-secondary"
            >
              {saveExclusions.isPending && <Spinner />}
              {saveExclusions.isPending ? '저장 중...' : '선택 저장'}
            </button>
          )}
          <button
            type="button"
            onClick={handleComplete}
            disabled={isBusy || !accessible || !initialized || stats.included === 0}
            className="nb-btn-primary"
          >
            {completeSelection.isPending && <Spinner className="text-white" />}
            {completeSelection.isPending
              ? '처리 중...'
              : selectionDone
                ? '선택 다시 확정 → 번역'
                : '선택 완료 → 번역'}
          </button>
        </div>
      </div>

      {!accessible && (
        <div className="nb-alert nb-alert--warning">{stepPrerequisiteMessage(3)}</div>
      )}

      {selectionDone && (
        <p className="text-sm text-emerald-600">
          번역 대상 선택이 완료되었습니다. 포함 {stats.included}개 · 제외 {stats.excluded}개
        </p>
      )}

      {!canEdit && accessible && (
        <div className="nb-alert nb-alert--warning">
          번역이 시작된 이후에는 제외 설정을 변경할 수 없습니다. 변경이 필요하면 프로젝트를 다시
          추출하거나 관리자에게 문의하세요.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-md bg-emerald-50 px-2.5 py-1 font-medium text-emerald-800">
          포함 {stats.included}
        </span>
        <span className="rounded-md bg-gray-100 px-2.5 py-1 font-medium text-gray-700">
          제외 {stats.excluded}
        </span>
        <span className="text-gray-500">전체 {stats.total}</span>
        {stats.emptyText > 0 && (
          <span className="rounded-md bg-amber-50 px-2.5 py-1 text-amber-800">
            포함 중 텍스트 없음 {stats.emptyText}
          </span>
        )}
      </div>

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setAll(false)} className="nb-btn-secondary text-xs">
            전체 포함
          </button>
          <button type="button" onClick={() => setAll(true)} className="nb-btn-secondary text-xs">
            전체 제외
          </button>
          <button
            type="button"
            onClick={() => excludeByTypes(QUICK_EXCLUDE_TYPES)}
            className="nb-btn-secondary text-xs"
          >
            인트로·구분·아웃트로 제외
          </button>
          <button type="button" onClick={excludeEmpty} className="nb-btn-secondary text-xs">
            텍스트 없는 슬라이드 제외
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {(
          [
            ['all', '전체'],
            ['include', '포함만'],
            ['exclude', '제외만'],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            onClick={() => setFilter(mode)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              filter === mode
                ? 'bg-[#162b52] text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading || !initialized ? (
        <div className="nb-empty-state">
          <Spinner className="text-gray-400" />
          <p className="text-sm text-gray-500">슬라이드 데이터를 불러오는 중...</p>
        </div>
      ) : slides.length === 0 ? (
        <div className="nb-empty-state">
          <p className="text-sm text-gray-500">표시할 슬라이드가 없습니다.</p>
        </div>
      ) : (
        <div className="nb-card nb-h-scroll overflow-hidden">
          <div className="overflow-x-auto">
            <table className="nb-table nb-extraction-table w-full">
              <colgroup>
                <col style={{ width: '7%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '30%' }} />
                <col style={{ width: '39%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="text-center">제외</th>
                  <th>번호</th>
                  <th>유형</th>
                  <th className="px-2">화면번호</th>
                  <th>화면텍스트</th>
                  <th>나레이션</th>
                </tr>
              </thead>
              <tbody>
                {filteredSlides.map((slide) => {
                  const isGuide = slide.slide_type === 'guide'
                  const isExcluded = excludedIds.has(slide.id)
                  const screenPreview = formatScreenText(slide.screen_text)
                  const narrationPreview = formatNarration(slide.narration)
                  const noText = !screenPreview.trim() && !narrationPreview.trim()

                  return (
                    <tr
                      key={slide.id}
                      className={
                        isExcluded
                          ? 'bg-gray-50/80 opacity-70'
                          : noText
                            ? 'bg-amber-50/40'
                            : 'hover:bg-gray-50/50'
                      }
                    >
                      <td className="px-2 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={isExcluded}
                          disabled={!canEdit || isGuide}
                          onChange={() => toggleExclude(slide)}
                          title={
                            isGuide
                              ? '가이드 슬라이드는 항상 번역에서 제외됩니다'
                              : isExcluded
                                ? '번역에 포함'
                                : '번역에서 제외'
                          }
                          className="h-4 w-4 rounded border-gray-300 text-[#162b52] focus:ring-[#162b52]"
                          aria-label={`슬라이드 ${slide.slide_num} 번역 제외`}
                        />
                      </td>
                      <td className="whitespace-nowrap px-2 py-3 font-medium text-gray-900">
                        {slide.slide_num}
                      </td>
                      <td className="whitespace-nowrap px-2 py-3">
                        <span className="nb-badge">{SLIDE_TYPE_LABELS[slide.slide_type]}</span>
                      </td>
                      <td className="px-2 py-3 text-center text-xs text-gray-700">
                        {slide.screen_num ?? '—'}
                      </td>
                      <td className="px-3 py-3">
                        <div className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-xs text-gray-800">
                          {screenPreview.trim() ? (
                            screenPreview
                          ) : (
                            <span className="text-gray-400">화면텍스트 없음</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-xs text-gray-800">
                          {narrationPreview.trim() ? (
                            narrationPreview
                          ) : (
                            <span className="text-gray-400">나레이션 없음</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {filteredSlides.length === 0 && slides.length > 0 && (
        <p className="text-center text-sm text-gray-500">현재 필터에 해당하는 슬라이드가 없습니다.</p>
      )}
    </div>
  )
}
