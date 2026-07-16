import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  AI_JOB_LABELS,
  makeAiJobKey,
  runSpellingJob,
  runTranslateJob,
  runVerifyJob,
  type AiJobKind,
  type SpellingCheckSummary,
} from '../lib/aiJobs'
import type { ChunkProgress } from '../lib/chunkProgress'
import { getErrorMessage } from '../lib/errors'
import { useToast } from './ToastProvider'

export type AiJobPhase = 'running' | 'done' | 'error'

export interface AiJobState {
  key: string
  kind: AiJobKind
  projectId: string
  projectTitle: string
  status: AiJobPhase
  progress: ChunkProgress | null
  errorMessage?: string
  successMessage?: string
  spellingSummary?: SpellingCheckSummary
  spellableSlideCount?: number
}

interface StartSpellingParams {
  projectId: string
  projectTitle: string
  slideIds: string[]
  spellableSlideCount: number
  /** false면 지정 슬라이드만 재검사하고 기존 검토 결과를 유지 */
  resetAllResults?: boolean
}

interface StartTranslateParams {
  projectId: string
  projectTitle: string
  slideIds: string[]
  targetLang: string
}

interface StartVerifyParams {
  projectId: string
  projectTitle: string
}

interface AiJobContextValue {
  jobs: AiJobState[]
  runningJobs: AiJobState[]
  getJob: (projectId: string, kind: AiJobKind) => AiJobState | undefined
  isRunning: (projectId: string, kind: AiJobKind) => boolean
  startSpellingJob: (params: StartSpellingParams) => boolean
  startTranslateJob: (params: StartTranslateParams) => boolean
  startVerifyJob: (params: StartVerifyParams) => boolean
  clearJob: (projectId: string, kind: AiJobKind) => void
}

const AiJobContext = createContext<AiJobContextValue | null>(null)

export function AiJobProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [jobsByKey, setJobsByKey] = useState<Record<string, AiJobState>>({})
  const runningKeysRef = useRef(new Set<string>())

  const updateJob = useCallback((key: string, patch: Partial<AiJobState>) => {
    setJobsByKey((prev) => {
      const current = prev[key]
      if (!current) return prev
      return { ...prev, [key]: { ...current, ...patch } }
    })
  }, [])

  const clearJob = useCallback((projectId: string, kind: AiJobKind) => {
    const key = makeAiJobKey(projectId, kind)
    runningKeysRef.current.delete(key)
    setJobsByKey((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  const beginJob = useCallback(
    (kind: AiJobKind, projectId: string, projectTitle: string): string | null => {
      const key = makeAiJobKey(projectId, kind)
      if (runningKeysRef.current.has(key)) {
        showToast(
          `이미 ${AI_JOB_LABELS[kind]}가 진행 중입니다. 완료될 때까지 기다려 주세요.`,
          'error',
        )
        return null
      }
      runningKeysRef.current.add(key)
      setJobsByKey((prev) => ({
        ...prev,
        [key]: {
          key,
          kind,
          projectId,
          projectTitle,
          status: 'running',
          progress: {
            current: 0,
            total: 1,
            phase: '준비 중',
            percent: 0,
          },
        },
      }))
      return key
    },
    [showToast],
  )

  const finishJob = useCallback((key: string, patch: Partial<AiJobState>) => {
    runningKeysRef.current.delete(key)
    updateJob(key, patch)
  }, [updateJob])

  const startSpellingJob = useCallback(
    (params: StartSpellingParams): boolean => {
      const key = beginJob('spelling', params.projectId, params.projectTitle)
      if (!key) return false

      void (async () => {
        try {
          const resetAll = params.resetAllResults !== false
          const summary = await runSpellingJob(queryClient, {
            projectId: params.projectId,
            slideIds: params.slideIds,
            resetAllResults: resetAll,
            onChunkProgress: (progress) => updateJob(key, { progress }),
          })

          const successMessage = resetAll
            ? summary.changeCount > 0
              ? `검사 완료: 텍스트 있음 ${params.spellableSlideCount}개 슬라이드 전체 검사, 검토 필요 ${summary.changeCount}건`
              : `검사 완료: 텍스트 있음 ${params.spellableSlideCount}개 슬라이드 전체 검사, 수정이 필요한 항목이 없습니다.`
            : `누락 ${params.slideIds.length}개 슬라이드 재검사 완료 (${summary.resultCount}건 결과)`

          finishJob(key, {
            status: 'done',
            progress: null,
            spellingSummary: summary,
            spellableSlideCount: params.spellableSlideCount,
            successMessage,
          })
          showToast(`「${params.projectTitle}」 ${successMessage}`, 'success')
        } catch (err) {
          const errorMessage = getErrorMessage(err, '맞춤법 검사에 실패했습니다.')
          finishJob(key, { status: 'error', errorMessage, progress: null })
          showToast(`「${params.projectTitle}」 ${errorMessage}`, 'error')
        }
      })()

      return true
    },
    [beginJob, finishJob, queryClient, showToast, updateJob],
  )

  const startTranslateJob = useCallback(
    (params: StartTranslateParams): boolean => {
      const key = beginJob('translate', params.projectId, params.projectTitle)
      if (!key) return false

      void (async () => {
        try {
          await runTranslateJob(queryClient, {
            projectId: params.projectId,
            slideIds: params.slideIds,
            targetLang: params.targetLang,
            onChunkProgress: (progress) => updateJob(key, { progress }),
          })
          const successMessage = '번역이 완료되었습니다. 역번역 검증을 실행해 주세요.'
          finishJob(key, { status: 'done', progress: null, successMessage })
          showToast(`「${params.projectTitle}」 ${successMessage}`, 'success')
        } catch (err) {
          const errorMessage = getErrorMessage(err, '번역에 실패했습니다.')
          finishJob(key, { status: 'error', errorMessage, progress: null })
          showToast(`「${params.projectTitle}」 ${errorMessage}`, 'error')
        }
      })()

      return true
    },
    [beginJob, finishJob, queryClient, showToast, updateJob],
  )

  const startVerifyJob = useCallback(
    (params: StartVerifyParams): boolean => {
      const key = beginJob('verify', params.projectId, params.projectTitle)
      if (!key) return false

      void (async () => {
        try {
          await runVerifyJob(queryClient, {
            projectId: params.projectId,
            onChunkProgress: (progress) => updateJob(key, { progress }),
          })
          const successMessage = '역번역 검증이 완료되었습니다.'
          finishJob(key, { status: 'done', progress: null, successMessage })
          showToast(`「${params.projectTitle}」 ${successMessage}`, 'success')
        } catch (err) {
          const errorMessage = getErrorMessage(err, '역번역 검증에 실패했습니다.')
          finishJob(key, { status: 'error', errorMessage, progress: null })
          showToast(`「${params.projectTitle}」 ${errorMessage}`, 'error')
        }
      })()

      return true
    },
    [beginJob, finishJob, queryClient, showToast, updateJob],
  )

  const jobs = useMemo(() => Object.values(jobsByKey), [jobsByKey])
  const runningJobs = useMemo(
    () => jobs.filter((job) => job.status === 'running'),
    [jobs],
  )

  const getJob = useCallback(
    (projectId: string, kind: AiJobKind) => jobsByKey[makeAiJobKey(projectId, kind)],
    [jobsByKey],
  )

  const isRunning = useCallback(
    (projectId: string, kind: AiJobKind) =>
      jobsByKey[makeAiJobKey(projectId, kind)]?.status === 'running',
    [jobsByKey],
  )

  const value = useMemo(
    () => ({
      jobs,
      runningJobs,
      getJob,
      isRunning,
      startSpellingJob,
      startTranslateJob,
      startVerifyJob,
      clearJob,
    }),
    [
      jobs,
      runningJobs,
      getJob,
      isRunning,
      startSpellingJob,
      startTranslateJob,
      startVerifyJob,
      clearJob,
    ],
  )

  return <AiJobContext.Provider value={value}>{children}</AiJobContext.Provider>
}

export function useAiJobs(): AiJobContextValue {
  const ctx = useContext(AiJobContext)
  if (!ctx) {
    throw new Error('useAiJobs는 AiJobProvider 내부에서 사용해야 합니다.')
  }
  return ctx
}

export function useAiJob(projectId: string, kind: AiJobKind): AiJobState | undefined {
  return useAiJobs().getJob(projectId, kind)
}
