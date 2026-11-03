import type {
  ProviderModelPublic,
} from '../providerModels'
import type { ProviderPublic } from '../providers'

export const HISTORY_LIMIT = 40

export type ProviderModelTestSummary = {
  tested: number
  passed: number
  failed: number
  enabled: number
  disabled: number
  total: number
}

export type ProviderModelTestKind = 'formats' | 'tools'

export type ProviderModelTestJobPublic = {
  id: number
  providerId: string
  kind: ProviderModelTestKind
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'error'
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  total: number
  tested: number
  passed: number
  failed: number
  enabled: number
  disabled: number
  error: string | null
  cancelRequested: boolean
}

export type ProviderModelTestQueueSnapshot = {
  waiting: ProviderModelTestJobPublic[]
  running: ProviderModelTestJobPublic[]
  recent: ProviderModelTestJobPublic[]
}

export type ProviderModelTestEvent =
  | {
    type: 'queue'
    queue: ProviderModelTestQueueSnapshot
  }
  | {
    type: 'started'
    jobId: number
    providerId: string
    kind: ProviderModelTestKind
    total: number
  }
  | {
    type: 'result'
    jobId: number
    providerId: string
    model: ProviderModelPublic
    ok: boolean
    index: number
    total: number
    summary: ProviderModelTestSummary
  }
  | {
    type: 'done'
    jobId: number
    providerId: string
    status: 'completed' | 'cancelled'
    provider: ProviderPublic
    models: ProviderModelPublic[]
    summary: ProviderModelTestSummary
  }
  | {
    type: 'error'
    jobId: number
    providerId: string
    message: string
  }

export type ProviderModelTestStatus = {
  providerId: string
  jobId: number | null
  kind: ProviderModelTestKind | null
  status: 'idle' | 'queued' | 'running' | 'completed' | 'cancelled' | 'error'
  total: number
  tested: number
  passed: number
  failed: number
  enabled: number
  disabled: number
  startedAt: string | null
  finishedAt: string | null
  error: string | null
  queue: ProviderModelTestQueueSnapshot
}

export type InternalJob = {
  id: number
  providerId: string
  kind: ProviderModelTestKind
  modelRowIds: string[]
  status: ProviderModelTestJobPublic['status']
  createdAt: string
  startedAt?: string
  finishedAt?: string
  total: number
  tested: number
  passed: number
  failed: number
  enabled: number
  disabled: number
  error?: string
  cancelRequested: boolean
  abortController?: AbortController
  history: ProviderModelTestEvent[]
  /** Request-scoped event used for data-root resolution while the job runs. */
  event?: import('h3').H3Event
}

export const waiting: InternalJob[] = []
export const runningByProvider = new Map<string, InternalJob>()
export const recent: InternalJob[] = []
export const providerBuses = new Map<string, Set<(event: ProviderModelTestEvent) => void>>()

export let nextJobId = 1
export let pumping = false

export function setPumping(value: boolean) {
  pumping = value
}

export function allocateJobId() {
  return nextJobId++
}

export function summaryOf(job: InternalJob): ProviderModelTestSummary {
  return {
    tested: job.tested,
    passed: job.passed,
    failed: job.failed,
    enabled: job.enabled,
    disabled: job.disabled,
    total: job.total,
  }
}

export function toPublic(job: InternalJob): ProviderModelTestJobPublic {
  return {
    id: job.id,
    providerId: job.providerId,
    kind: job.kind,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null,
    total: job.total,
    tested: job.tested,
    passed: job.passed,
    failed: job.failed,
    enabled: job.enabled,
    disabled: job.disabled,
    error: job.error ?? null,
    cancelRequested: job.cancelRequested,
  }
}

export function getProviderModelTestQueueSnapshot(): ProviderModelTestQueueSnapshot {
  return {
    waiting: waiting.map(toPublic),
    running: [...runningByProvider.values()].map(toPublic),
    recent: recent.slice(0, 20).map(toPublic),
  }
}

export function activeJobForProvider(providerId: string): InternalJob | null {
  return runningByProvider.get(providerId)
    || waiting.find(job => job.providerId === providerId)
    || null
}

export function latestJobForProvider(providerId: string): InternalJob | null {
  return activeJobForProvider(providerId)
    || recent.find(job => job.providerId === providerId)
    || null
}

export function statusFromJob(providerId: string, job: InternalJob | null): ProviderModelTestStatus {
  if (!job) {
    return {
      providerId,
      jobId: null,
      kind: null,
      status: 'idle',
      total: 0,
      tested: 0,
      passed: 0,
      failed: 0,
      enabled: 0,
      disabled: 0,
      startedAt: null,
      finishedAt: null,
      error: null,
      queue: getProviderModelTestQueueSnapshot(),
    }
  }
  return {
    providerId,
    jobId: job.id,
    kind: job.kind,
    status: job.status,
    total: job.total,
    tested: job.tested,
    passed: job.passed,
    failed: job.failed,
    enabled: job.enabled,
    disabled: job.disabled,
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null,
    error: job.error ?? null,
    queue: getProviderModelTestQueueSnapshot(),
  }
}

export function publish(providerId: string, event: ProviderModelTestEvent) {
  const bus = providerBuses.get(providerId)
  if (!bus) {
    return
  }
  for (const listener of bus) {
    try {
      listener(event)
    }
    catch {
      // Ignore broken listeners.
    }
  }
}

export function emitJob(job: InternalJob, event: ProviderModelTestEvent) {
  job.history.push(event)
  publish(job.providerId, event)
}

export function emitQueue(providerId?: string) {
  const event: ProviderModelTestEvent = {
    type: 'queue',
    queue: getProviderModelTestQueueSnapshot(),
  }
  if (providerId) {
    publish(providerId, event)
    return
  }
  const ids = new Set<string>([
    ...waiting.map(job => job.providerId),
    ...runningByProvider.keys(),
    ...providerBuses.keys(),
  ])
  for (const id of ids) {
    publish(id, event)
  }
}

export function archiveJob(job: InternalJob) {
  recent.unshift(job)
  if (recent.length > HISTORY_LIMIT) {
    recent.length = HISTORY_LIMIT
  }
}

export function findJob(id: number) {
  for (const job of runningByProvider.values()) {
    if (job.id === id) {
      return { job, list: 'running' as const }
    }
  }
  const waitingIndex = waiting.findIndex(job => job.id === id)
  if (waitingIndex >= 0) {
    return { job: waiting[waitingIndex]!, list: 'waiting' as const, index: waitingIndex }
  }
  const recentIndex = recent.findIndex(job => job.id === id)
  if (recentIndex >= 0) {
    return { job: recent[recentIndex]!, list: 'recent' as const, index: recentIndex }
  }
  return null
}
