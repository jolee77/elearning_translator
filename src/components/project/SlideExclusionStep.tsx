import { useEffect, useMemo, useState } from 'react'
import { SLIDE_TYPE_LABELS } from '../../lib/pptxParser'
import { buildSelectableFields, extractFieldBadgeClass, extractFieldPanelClass, fieldKeyLabel } from '../../lib/slideFields'
import { isStepAccessible, stepPrerequisiteMessage } from '../../lib/projectStatus'
import {
  useCompleteSlideSelection,
  useSaveSlideExclusions,
  useSlides,
  type SlideExclusionRow,
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

function fieldKey(slideId: string, field: string): string {
  return `${slideId}::${field}`
}

export function SlideExclusionStep({ project, onStepComplete }: SlideExclusionStepProps) {
  const { showToast } = useToast()
  const { data: slides = [], isLoading } = useSlides(project.id)
  const saveExclusions = useSaveSlideExclusions()
  const completeSelection = useCompleteSlideSelection()

  /** 제외할 필드 키: `${slideId}::${field_key}` */
  const [excludedKeys, setExcludedKeys] = useState<Set<string>>(new Set())
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<FilterMode>('all')
  const [initialized, setInitialized] = useState(false)

  const accessible = isStepAccessible(3, project.status)
  const selectionDone =
    project.status === 'selection_done' ||
    ['translating', 'translated', 'verifying', 'verified', 'expert_review', 'done'].includes(
      project.status,
    )
  const canEdit =
    accessible &&
    !['translating', 'translated', 'verifying', 'verified', 'expert_review', 'done'].includes(
      project.status,
    )

  const slideFields = useMemo(() => {
    return new Map(slides.map((slide) => [slide.id, buildSelectableFields(slide)] as const))
  }, [slides])

  useEffect(() => {
    if (slides.length === 0) return
    const next = new Set<string>()
    const collapsed = new Set<string>()

    for (const slide of slides) {
      const fields = buildSelectableFields(slide)
      if (slide.slide_type === 'guide' || slide.exclude_from_translation) {
        if (fields.length === 0) next.add(fieldKey(slide.id, '__empty__'))
        for (const f of fields) next.add(fieldKey(slide.id, f.field_key))
        collapsed.add(slide.id)
        continue
      }
      const excludedSet = new Set(slide.excluded_fields ?? [])
      for (const f of fields) {
        if (excludedSet.has(f.field_key)) next.add(fieldKey(slide.id, f.field_key))
      }
      if (fields.length > 0 && fields.every((f) => excludedSet.has(f.field_key))) {
        collapsed.add(slide.id)
      }
    }

    setExcludedKeys(next)
    setCollapsedIds(collapsed)
    setInitialized(true)
  }, [slides])

  const isSlideFullyExcluded = (slide: Slide) => {
    if (slide.slide_type === 'guide') return true
    const fields = slideFields.get(slide.id) ?? []
    if (fields.length === 0) return excludedKeys.has(fieldKey(slide.id, '__empty__'))
    return fields.every((f) => excludedKeys.has(fieldKey(slide.id, f.field_key)))
  }

  const stats = useMemo(() => {
    let includedSlides = 0
    let excludedSlides = 0
    let includedFields = 0
    let excludedFields = 0

    for (const slide of slides) {
      if (slide.slide_type === 'guide') {
        excludedSlides += 1
        continue
      }
      const fields = slideFields.get(slide.id) ?? []
      if (fields.length === 0) {
        if (isSlideFullyExcluded(slide)) excludedSlides += 1
        else includedSlides += 1
        continue
      }
      let slideExcluded = 0
      for (const f of fields) {
        if (excludedKeys.has(fieldKey(slide.id, f.field_key))) {
          excludedFields += 1
          slideExcluded += 1
        } else {
          includedFields += 1
        }
      }
      if (slideExcluded === fields.length) excludedSlides += 1
      else includedSlides += 1
    }

    return {
      includedSlides,
      excludedSlides,
      includedFields,
      excludedFields,
      total: slides.length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides, slideFields, excludedKeys])

  const filteredSlides = useMemo(() => {
    return slides.filter((slide) => {
      const fully = isSlideFullyExcluded(slide)
      if (filter === 'include') return !fully
      if (filter === 'exclude') return fully
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides, excludedKeys, filter, slideFields])

  const toggleField = (slide: Slide, field: string) => {
    if (!canEdit || slide.slide_type === 'guide') return
    const key = fieldKey(slide.id, field)
    setExcludedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleSlide = (slide: Slide) => {
    if (!canEdit || slide.slide_type === 'guide') return
    const fields = slideFields.get(slide.id) ?? []
    setExcludedKeys((prev) => {
      const next = new Set(prev)
      if (fields.length === 0) {
        const key = fieldKey(slide.id, '__empty__')
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      }
      const keys = fields.map((f) => fieldKey(slide.id, f.field_key))
      const allExcluded = keys.every((k) => next.has(k))
      if (allExcluded) {
        for (const k of keys) next.delete(k)
      } else {
        for (const k of keys) next.add(k)
      }
      return next
    })
  }

  const setAll = (exclude: boolean) => {
    if (!canEdit) return
    if (exclude) {
      const next = new Set<string>()
      for (const slide of slides) {
        for (const f of slideFields.get(slide.id) ?? []) {
          next.add(fieldKey(slide.id, f.field_key))
        }
      }
      setExcludedKeys(next)
      return
    }
    const next = new Set<string>()
    for (const slide of slides) {
      if (slide.slide_type !== 'guide') continue
      for (const f of slideFields.get(slide.id) ?? []) {
        next.add(fieldKey(slide.id, f.field_key))
      }
    }
    setExcludedKeys(next)
  }

  const excludeByTypes = (types: SlideType[]) => {
    if (!canEdit) return
    setExcludedKeys((prev) => {
      const next = new Set(prev)
      for (const slide of slides) {
        if (!types.includes(slide.slide_type) && slide.slide_type !== 'guide') continue
        for (const f of slideFields.get(slide.id) ?? []) {
          next.add(fieldKey(slide.id, f.field_key))
        }
      }
      return next
    })
  }

  const excludeEmpty = () => {
    if (!canEdit) return
    setExcludedKeys((prev) => {
      const next = new Set(prev)
      for (const slide of slides) {
        const fields = slideFields.get(slide.id) ?? []
        if (slide.slide_type === 'guide' || fields.length === 0) {
          if (fields.length === 0) next.add(fieldKey(slide.id, '__empty__'))
          for (const f of fields) next.add(fieldKey(slide.id, f.field_key))
        }
      }
      return next
    })
  }

  const buildExclusionRows = (): SlideExclusionRow[] => {
    return slides.map((slide) => {
      const fields = slideFields.get(slide.id) ?? []
      const excluded_fields = fields
        .filter((f) => excludedKeys.has(fieldKey(slide.id, f.field_key)))
        .map((f) => f.field_key)
      const emptyExcluded = fields.length === 0 && excludedKeys.has(fieldKey(slide.id, '__empty__'))
      const exclude_from_translation =
        slide.slide_type === 'guide' ||
        emptyExcluded ||
        (fields.length > 0 && excluded_fields.length === fields.length)

      return {
        id: slide.id,
        exclude_from_translation,
        excluded_fields: exclude_from_translation ? [] : excluded_fields,
      }
    })
  }

  const handleSave = async () => {
    if (!canEdit) return
    try {
      await saveExclusions.mutateAsync({
        projectId: project.id,
        exclusions: buildExclusionRows(),
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
    if (stats.includedFields === 0 && stats.includedSlides === 0) {
      showToast('번역할 텍스트가 최소 1건 필요합니다.', 'error')
      return
    }
    // 텍스트 없는 포함 슬라이드만 있는 경우 방지
    if (stats.includedFields === 0) {
      showToast('번역할 텍스트가 최소 1건 필요합니다. 필드 제외를 확인해 주세요.', 'error')
      return
    }
    try {
      await completeSelection.mutateAsync({
        projectId: project.id,
        exclusions: buildExclusionRows(),
        includedSlideCount: stats.includedSlides,
        excludedSlideCount: stats.excludedSlides,
        excludedFieldCount: stats.excludedFields,
      })
      showToast('번역 대상 선택이 완료되었습니다.', 'success')
      onStepComplete?.()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '선택 완료 처리에 실패했습니다.', 'error')
    }
  }

  const toggleCollapsed = (slideId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(slideId)) next.delete(slideId)
      else next.add(slideId)
      return next
    })
  }

  const isBusy = saveExclusions.isPending || completeSelection.isPending

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Step 3. 번역 대상 선택</h3>
          <p className="mt-1 text-sm text-gray-500">
            슬라이드·텍스트 단위로 번역(및 이후 전문가 검증)에서 제외할 항목을 선택하세요. 여기서 한
            번만 정하면 됩니다.
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
            disabled={isBusy || !accessible || !initialized || stats.includedFields === 0}
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
          번역 대상 선택이 완료되었습니다. 슬라이드 포함 {stats.includedSlides} · 제외{' '}
          {stats.excludedSlides} · 필드 제외 {stats.excludedFields}
        </p>
      )}

      {!canEdit && accessible && (
        <div className="nb-alert nb-alert--warning">
          번역이 시작된 이후에는 제외 설정을 변경할 수 없습니다.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-md bg-emerald-50 px-2.5 py-1 font-medium text-emerald-800">
          포함 슬라이드 {stats.includedSlides}
        </span>
        <span className="rounded-md bg-gray-100 px-2.5 py-1 font-medium text-gray-700">
          제외 슬라이드 {stats.excludedSlides}
        </span>
        <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-emerald-800">
          포함 텍스트 {stats.includedFields}
        </span>
        <span className="rounded-md bg-gray-100 px-2.5 py-1 text-gray-700">
          제외 텍스트 {stats.excludedFields}
        </span>
      </div>

      <div className="nb-extract-legend">
        <span>
          <span className="nb-extract-legend-swatch nb-extract-legend-swatch--screen" />
          화면텍스트
        </span>
        <span>
          <span className="nb-extract-legend-swatch nb-extract-legend-swatch--narration" />
          나레이션
        </span>
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
          <button
            type="button"
            onClick={() => setCollapsedIds(new Set())}
            className="nb-btn-secondary text-xs"
          >
            모두 펼치기
          </button>
          <button
            type="button"
            onClick={() => setCollapsedIds(new Set(slides.map((s) => s.id)))}
            className="nb-btn-secondary text-xs"
          >
            모두 접기
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
        <div className="space-y-3">
          {filteredSlides.map((slide) => {
            const fields = slideFields.get(slide.id) ?? []
            const isGuide = slide.slide_type === 'guide'
            const fullyExcluded = isSlideFullyExcluded(slide)
            const excludedCount = fields.filter((f) =>
              excludedKeys.has(fieldKey(slide.id, f.field_key)),
            ).length
            const someExcluded = excludedCount > 0 && excludedCount < fields.length
            const isCollapsed = collapsedIds.has(slide.id)

            return (
              <div
                key={slide.id}
                className={`nb-card overflow-hidden ${fullyExcluded ? 'opacity-70' : ''}`}
              >
                <div className="nb-card-header">
                  <div className="flex flex-wrap items-center gap-2">
                    <label
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={fullyExcluded}
                        ref={(el) => {
                          if (el) el.indeterminate = someExcluded
                        }}
                        disabled={!canEdit || isGuide}
                        onChange={() => toggleSlide(slide)}
                        className="rounded border-gray-300 text-[#162b52] focus:ring-[#162b52]"
                        title={
                          isGuide
                            ? '가이드 슬라이드는 항상 제외됩니다'
                            : '이 슬라이드 텍스트를 모두 제외/포함'
                        }
                        aria-label={`슬라이드 ${slide.slide_num} 전체 제외`}
                      />
                      슬라이드 제외
                    </label>
                    <button
                      type="button"
                      onClick={() => toggleCollapsed(slide.id)}
                      className="flex flex-wrap items-center gap-2 text-left"
                      aria-expanded={!isCollapsed}
                    >
                      <svg
                        className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${
                          isCollapsed ? '' : 'rotate-90'
                        }`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        aria-hidden
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                      <h4 className="text-sm font-semibold text-gray-800">
                        슬라이드 {slide.slide_num}
                      </h4>
                      <span className="nb-badge">{SLIDE_TYPE_LABELS[slide.slide_type]}</span>
                      {slide.screen_num && (
                        <span className="text-xs text-gray-500">{slide.screen_num}</span>
                      )}
                      <span className="text-xs text-gray-500">
                        {fields.length}항목
                        {fullyExcluded
                          ? ' · 전부 제외'
                          : someExcluded
                            ? ` · 일부 제외(${excludedCount})`
                            : ''}
                      </span>
                      <span className="text-xs text-gray-400">
                        {isCollapsed ? '펼치기' : '접기'}
                      </span>
                    </button>
                  </div>
                </div>

                {!isCollapsed && (
                  <div className="divide-y divide-gray-100">
                    {fields.length === 0 ? (
                      <p className="px-4 py-3 text-xs text-gray-500">추출된 텍스트가 없습니다.</p>
                    ) : (
                      fields.map((field) => {
                        const excluded = excludedKeys.has(fieldKey(slide.id, field.field_key))
                        return (
                          <div
                            key={field.field_key}
                            className={`px-4 py-3 ${excluded ? 'bg-gray-50/80' : ''}`}
                          >
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <label className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700">
                                <input
                                  type="checkbox"
                                  checked={excluded}
                                  disabled={!canEdit || isGuide}
                                  onChange={() => toggleField(slide, field.field_key)}
                                  className="rounded border-gray-300 text-[#162b52] focus:ring-[#162b52]"
                                />
                                제외
                              </label>
                              <span className={extractFieldBadgeClass(field.field_key)}>
                                {fieldKeyLabel(field.field_key)}
                              </span>
                              {excluded && (
                                <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600">
                                  번역·전문가 검증 제외
                                </span>
                              )}
                            </div>
                            <p className={extractFieldPanelClass(field.field_key, excluded)}>
                              {field.text}
                            </p>
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {filteredSlides.length === 0 && slides.length > 0 && (
        <p className="text-center text-sm text-gray-500">현재 필터에 해당하는 슬라이드가 없습니다.</p>
      )}
    </div>
  )
}
