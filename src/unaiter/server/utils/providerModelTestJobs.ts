import type { H3Event } from 'h3'
import { testOpenAiCompatibleModelFormats } from './openaiCompatible'
import type { ModelTask } from './modelTasks'
import {
  toPublicModel,
} from './providerModels'
import {
  findProviderOrThrow,
  readStore,
  toPublicProvider,
  writeStore,
} from './providers'
import {
  activeJobForProvider,
  allocateJobId,
  archiveJob,
  emitJob,
  emitQueue,
  findJob,
  getProviderModelTestQueueSnapshot,
  latestJobForProvider,
  providerBuses,
  runningByProvider,
  setPumping,
  statusFromJob,
  summaryOf,
  toPublic,
  waiting,
  pumping,
  type InternalJob,
  type ProviderModelTestEvent,
} from './providerModelTestQueue/state'
export type {
  ProviderModelTestEvent,
  ProviderModelTestJobPublic,
  ProviderModelTestQueueSnapshot,
  ProviderModelTestStatus,
  ProviderModelTestSummary,
} from './providerModelTestQueue/state'

export { getProviderModelTestQueueSnapshot } from './providerModelTestQueue/state'
export { getProviderModelTestStatus } from './providerModelTestQueue/status'

function firstUsableKey(provider: { keys: Array<{ key: string, valid: boolean | null }> }) {
  const valid = provider.keys.find(item => item.valid === true)
  if (valid) {
    return valid.key
  }
  return provider.keys[0]?.key || ''
}

export function subscribeProviderModelTest(
  providerId: string,
  listener: (event: ProviderModelTestEvent) => void,
): () => void {
  let bus = providerBuses.get(providerId)
  if (!bus) {
    bus = new Set()
    providerBuses.set(providerId, bus)
  }

  const latest = latestJobForProvider(providerId)
  if (latest) {
    for (const event of latest.history) {
      listener(event)
    }
  }
  else {
    listener({ type: 'queue', queue: getProviderModelTestQueueSnapshot() })
  }

  bus.add(listener)
  return () => {
    bus!.delete(listener)
    if (bus!.size === 0) {
      providerBuses.delete(providerId)
    }
  }
}

export function cancelProviderModelTestJob(jobId: number) {
  const found = findJob(jobId)
  if (!found) {
    return { cancelled: false as const, job: null, queue: getProviderModelTestQueueSnapshot() }
  }

  const { job, list } = found
  if (list === 'recent' || job.status === 'completed' || job.status === 'cancelled' || job.status === 'error') {
    return { cancelled: false as const, job: toPublic(job), queue: getProviderModelTestQueueSnapshot() }
  }

  job.cancelRequested = true

  if (list === 'waiting') {
    waiting.splice(found.index!, 1)
    finishCancelledQueuedJob(job)
    emitQueue()
    void pumpQueue()
    return { cancelled: true as const, job: toPublic(job), queue: getProviderModelTestQueueSnapshot() }
  }

  try {
    job.abortController?.abort()
  }
  catch {
    // already aborted
  }
  return { cancelled: true as const, job: toPublic(job), queue: getProviderModelTestQueueSnapshot() }
}

function finishCancelledQueuedJob(job: InternalJob) {
  job.status = 'cancelled'
  job.finishedAt = new Date().toISOString()
  archiveJob(job)
  const providers = readStore(job.event)
  const provider = findProviderOrThrow(providers, job.providerId)
  emitJob(job, {
    type: 'done',
    jobId: job.id,
    providerId: job.providerId,
    status: 'cancelled',
    provider: toPublicProvider(provider),
    models: provider.models.map(toPublicModel),
    summary: summaryOf(job),
  })
}

/** Cancel the active (running or first queued) job for a provider. */
export function cancelProviderModelTest(providerId: string) {
  const job = activeJobForProvider(providerId)
  if (!job) {
    return {
      cancelled: false as const,
      status: statusFromJob(providerId, null),
    }
  }
  const result = cancelProviderModelTestJob(job.id)
  return {
    cancelled: result.cancelled,
    status: statusFromJob(providerId, latestJobForProvider(providerId)),
    job: result.job,
    queue: result.queue,
  }
}

export function enqueueProviderModelTest(
  providerId: string,
  modelRowIds: string[] | undefined,
  event?: H3Event,
) {
  const providers = readStore(event)
  const provider = findProviderOrThrow(providers, providerId)
  const targets = modelRowIds?.length
    ? provider.models.filter(item => modelRowIds.includes(item.id))
    : [...provider.models]

  if (targets.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No models to test',
    })
  }

  const job: InternalJob = {
    id: allocateJobId(),
    providerId,
    modelRowIds: targets.map(item => item.id),
    status: 'queued',
    createdAt: new Date().toISOString(),
    total: targets.length,
    tested: 0,
    passed: 0,
    failed: 0,
    enabled: 0,
    disabled: 0,
    cancelRequested: false,
    history: [],
    event,
  }

  waiting.push(job)
  emitQueue(providerId)
  void pumpQueue()

  return {
    enqueued: true as const,
    job: toPublic(job),
    status: statusFromJob(providerId, job),
    queue: getProviderModelTestQueueSnapshot(),
  }
}

/** @deprecated Use enqueueProviderModelTest */
export function startProviderModelTest(
  providerId: string,
  modelRowIds: string[] | undefined,
  event?: H3Event,
) {
  const result = enqueueProviderModelTest(providerId, modelRowIds, event)
  return {
    started: true as const,
    job: result.job,
    status: result.status,
    queue: result.queue,
  }
}

async function pumpQueue() {
  if (pumping) {
    return
  }
  setPumping(true)
  try {
    while (true) {
      const index = waiting.findIndex(job => !runningByProvider.has(job.providerId))
      if (index === -1) {
        break
      }
      const [job] = waiting.splice(index, 1)
      if (!job) {
        break
      }
      if (job.cancelRequested) {
        finishCancelledQueuedJob(job)
        continue
      }
      void runJob(job)
    }
  }
  finally {
    setPumping(false)
  }
}

async function runJob(job: InternalJob) {
  job.status = 'running'
  job.startedAt = new Date().toISOString()
  job.abortController = new AbortController()
  runningByProvider.set(job.providerId, job)
  emitJob(job, {
    type: 'started',
    jobId: job.id,
    providerId: job.providerId,
    total: job.total,
  })
  emitQueue()

  try {
    for (const modelRowId of job.modelRowIds) {
      if (job.cancelRequested || job.abortController.signal.aborted) {
        break
      }

      const providersForKey = readStore(job.event)
      const providerForKey = findProviderOrThrow(providersForKey, job.providerId)
      const target = providerForKey.models.find(item => item.id === modelRowId)
      if (!target) {
        continue
      }

      const apiKey = firstUsableKey(providerForKey)
      let ok = false
      let tasks: ModelTask[] = []
      try {
        const result = await testOpenAiCompatibleModelFormats(
          providerForKey.baseUrl,
          apiKey,
          target.modelId,
          target.providerMeta,
          job.abortController.signal,
          { adapterId: providerForKey.adapterId },
        )
        ok = result.ok
        tasks = result.tasks
      }
      catch (err) {
        if (job.cancelRequested || job.abortController.signal.aborted) {
          break
        }
        if (err instanceof Error && err.name === 'AbortError') {
          break
        }
        ok = false
        tasks = []
      }

      if (job.cancelRequested || job.abortController.signal.aborted) {
        break
      }

      const now = new Date().toISOString()
      const providers = readStore(job.event)
      const provider = findProviderOrThrow(providers, job.providerId)
      const model = provider.models.find(item => item.id === modelRowId)
      if (!model) {
        continue
      }

      model.tasks = tasks
      model.lastTestOk = ok
      model.testedAt = now
      job.tested += 1

      if (ok) {
        job.passed += 1
        if (!model.enabled) {
          model.enabled = true
          job.enabled += 1
        }
      }
      else {
        job.failed += 1
        if (model.enabled) {
          model.enabled = false
          job.disabled += 1
        }
      }

      provider.updatedAt = now
      writeStore(providers, job.event)

      emitJob(job, {
        type: 'result',
        jobId: job.id,
        providerId: job.providerId,
        model: toPublicModel(model),
        ok,
        index: job.tested,
        total: job.total,
        summary: summaryOf(job),
      })
    }

    job.finishedAt = new Date().toISOString()
    job.status = job.cancelRequested || job.abortController.signal.aborted
      ? 'cancelled'
      : 'completed'

    const providers = readStore(job.event)
    const provider = findProviderOrThrow(providers, job.providerId)
    emitJob(job, {
      type: 'done',
      jobId: job.id,
      providerId: job.providerId,
      status: job.status,
      provider: toPublicProvider(provider),
      models: provider.models.map(toPublicModel),
      summary: summaryOf(job),
    })
  }
  catch (err) {
    job.status = 'error'
    job.finishedAt = new Date().toISOString()
    job.error = err instanceof Error ? err.message : 'Model test failed'
    emitJob(job, {
      type: 'error',
      jobId: job.id,
      providerId: job.providerId,
      message: job.error,
    })
  }
  finally {
    job.abortController = undefined
    runningByProvider.delete(job.providerId)
    archiveJob(job)
    emitQueue()
    void pumpQueue()
  }
}
