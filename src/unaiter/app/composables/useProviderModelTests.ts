import type {
  ProviderModelPublic,
  ProviderModelTestEvent,
  ProviderModelTestJobPublic,
  ProviderModelTestKind,
  ProviderModelTestQueueSnapshot,
  ProviderModelTestStatus,
} from '~/types/providers'
import { apiErrorMessage } from '~/utils/apiError'

type ClientJob = {
  jobId: number | null
  kind: ProviderModelTestKind
  status: ProviderModelTestStatus['status']
  total: number
  tested: number
  passed: number
  failed: number
  enabled: number
  disabled: number
  error: string | null
  models: ProviderModelPublic[] | null
  queue: ProviderModelTestQueueSnapshot | null
}

function jobLabel(kind: ProviderModelTestKind) {
  return kind === 'tools' ? 'Tool test' : 'Model test'
}

type ModelUpdate = {
  model?: ProviderModelPublic
  models?: ProviderModelPublic[]
}

type ModelListener = (update: ModelUpdate) => void
type DoneListener = (event: Extract<ProviderModelTestEvent, { type: 'done' }>) => void

const sources = new Map<string, EventSource>()
const modelListeners = new Map<string, Set<ModelListener>>()
const doneListeners = new Map<string, Set<DoneListener>>()

function emptyQueue(): ProviderModelTestQueueSnapshot {
  return { waiting: [], running: [], recent: [] }
}

function emptyJob(): ClientJob {
  return {
    jobId: null,
    kind: 'formats',
    status: 'idle',
    total: 0,
    tested: 0,
    passed: 0,
    failed: 0,
    enabled: 0,
    disabled: 0,
    error: null,
    models: null,
    queue: null,
  }
}

function notifyModels(providerId: string, update: ModelUpdate) {
  const listeners = modelListeners.get(providerId)
  if (!listeners) {
    return
  }
  for (const listener of listeners) {
    listener(update)
  }
}

function notifyDone(
  providerId: string,
  event: Extract<ProviderModelTestEvent, { type: 'done' }>,
) {
  const listeners = doneListeners.get(providerId)
  if (!listeners) {
    return
  }
  for (const listener of listeners) {
    listener(event)
  }
}

function closeSource(providerId: string) {
  const source = sources.get(providerId)
  if (!source) {
    return
  }
  source.close()
  sources.delete(providerId)
}

function isActiveStatus(status: ClientJob['status']) {
  return status === 'queued' || status === 'running'
}

/**
 * Background model-test queue (dns01-style jobs with ids).
 * SSE stays open after the drawer closes so tests keep updating client state.
 */
export function useProviderModelTests() {
  const jobs = useState<Record<string, ClientJob>>('provider-model-tests', () => ({}))
  const toast = useToast()

  function ensureJob(providerId: string): ClientJob {
    if (!jobs.value[providerId]) {
      jobs.value = { ...jobs.value, [providerId]: emptyJob() }
    }
    return jobs.value[providerId]!
  }

  function patchJob(providerId: string, patch: Partial<ClientJob>) {
    const current = ensureJob(providerId)
    jobs.value = {
      ...jobs.value,
      [providerId]: { ...current, ...patch },
    }
  }

  function applyPublicJob(providerId: string, job: ProviderModelTestJobPublic) {
    patchJob(providerId, {
      jobId: job.id,
      kind: job.kind || 'formats',
      status: job.status,
      total: job.total,
      tested: job.tested,
      passed: job.passed,
      failed: job.failed,
      enabled: job.enabled,
      disabled: job.disabled,
      error: job.error,
    })
  }

  function handleEvent(providerId: string, event: ProviderModelTestEvent) {
    if (event.type === 'queue') {
      patchJob(providerId, { queue: event.queue })
      const active = event.queue.running.find(item => item.providerId === providerId)
        || event.queue.waiting.find(item => item.providerId === providerId)
      if (active) {
        applyPublicJob(providerId, active)
      }
      return
    }

    if (event.type === 'started') {
      patchJob(providerId, {
        jobId: event.jobId,
        kind: event.kind || 'formats',
        status: 'running',
        total: event.total,
        tested: 0,
        passed: 0,
        failed: 0,
        enabled: 0,
        disabled: 0,
        error: null,
      })
      return
    }

    if (event.type === 'result') {
      const job = ensureJob(providerId)
      const models = [...(job.models || [])]
      const index = models.findIndex(item => item.id === event.model.id)
      if (index === -1) {
        models.push(event.model)
      }
      else {
        models[index] = event.model
      }
      patchJob(providerId, {
        jobId: event.jobId,
        status: 'running',
        models,
        tested: event.summary.tested,
        passed: event.summary.passed,
        failed: event.summary.failed,
        enabled: event.summary.enabled,
        disabled: event.summary.disabled,
        total: event.summary.total,
      })
      notifyModels(providerId, { model: event.model })
      return
    }

    if (event.type === 'done') {
      const kind = ensureJob(providerId).kind
      const label = jobLabel(kind)
      patchJob(providerId, {
        jobId: event.jobId,
        status: event.status,
        models: event.models,
        tested: event.summary.tested,
        passed: event.summary.passed,
        failed: event.summary.failed,
        enabled: event.summary.enabled,
        disabled: event.summary.disabled,
        total: event.summary.total,
        error: null,
      })
      notifyModels(providerId, { models: event.models })
      notifyDone(providerId, event)
      closeSource(providerId)
      const description = kind === 'tools'
        ? `Tested ${event.summary.tested} of ${event.summary.total}: ${event.summary.passed} with tools, ${event.summary.failed} without.`
        : `Tested ${event.summary.tested} of ${event.summary.total}: ${event.summary.passed} passed (${event.summary.enabled} enabled), ${event.summary.failed} failed (${event.summary.disabled} disabled).`
      toast.add({
        title: event.status === 'cancelled'
          ? `${label} #${event.jobId} cancelled`
          : `${label} #${event.jobId} finished`,
        description,
        color: event.status === 'cancelled'
          ? 'neutral'
          : event.summary.failed ? 'warning' : 'success',
      })
      return
    }

    if (event.type === 'error') {
      const kind = ensureJob(providerId).kind
      patchJob(providerId, {
        jobId: event.jobId,
        status: 'error',
        error: event.message,
      })
      closeSource(providerId)
      toast.add({
        title: `${jobLabel(kind)} #${event.jobId} failed`,
        description: event.message,
        color: 'error',
      })
    }
  }

  function subscribe(providerId: string) {
    if (!import.meta.client) {
      return
    }
    if (sources.has(providerId)) {
      return
    }

    const source = new EventSource(`/api/providers/${providerId}/models/test/events`)
    sources.set(providerId, source)

    const onMessage = (message: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(message.data) as ProviderModelTestEvent
        handleEvent(providerId, payload)
      }
      catch {
        // Ignore malformed frames.
      }
    }

    for (const name of ['queue', 'started', 'result', 'done', 'error', 'message'] as const) {
      source.addEventListener(name, onMessage as EventListener)
    }

    source.onerror = () => {
      const job = jobs.value[providerId]
      if (job && !isActiveStatus(job.status)) {
        closeSource(providerId)
      }
    }
  }

  async function refreshStatus(providerId: string) {
    try {
      const status = await $fetch<ProviderModelTestStatus>(
        `/api/providers/${providerId}/models/test/status`,
      )
      patchJob(providerId, {
        jobId: status.jobId,
        kind: status.kind || 'formats',
        status: status.status,
        total: status.total,
        tested: status.tested,
        passed: status.passed,
        failed: status.failed,
        enabled: status.enabled,
        disabled: status.disabled,
        error: status.error,
        queue: status.queue || emptyQueue(),
      })
      if (isActiveStatus(status.status)) {
        subscribe(providerId)
      }
      return status
    }
    catch (err: unknown) {
      toast.add({
        title: 'Could not load test status',
        description: apiErrorMessage(err),
        color: 'error',
      })
      return null
    }
  }

  async function startTest(
    providerId: string,
    ids?: string[],
    kind: ProviderModelTestKind = 'formats',
  ) {
    const label = jobLabel(kind)
    try {
      const result = await $fetch<{
        enqueued: boolean
        job: ProviderModelTestJobPublic
        status: ProviderModelTestStatus
        queue: ProviderModelTestQueueSnapshot
      }>(`/api/providers/${providerId}/models/test`, {
        method: 'POST',
        body: {
          kind,
          ...(ids?.length ? { ids } : {}),
        },
      })
      applyPublicJob(providerId, result.job)
      patchJob(providerId, {
        models: null,
        error: null,
        queue: result.queue,
      })
      subscribe(providerId)
      if (result.job.status === 'queued') {
        toast.add({
          title: `${label} #${result.job.id} queued`,
          description: 'Waiting for this provider’s current test to finish.',
          color: 'neutral',
        })
      }
      return result
    }
    catch (err: unknown) {
      toast.add({
        title: `Could not enqueue ${label.toLowerCase()}`,
        description: apiErrorMessage(err),
        color: 'error',
      })
      return null
    }
  }

  async function cancelTest(providerId: string, jobId?: number | null) {
    try {
      const result = await $fetch<{
        cancelled: boolean
        job?: ProviderModelTestJobPublic | null
        status?: ProviderModelTestStatus
        queue?: ProviderModelTestQueueSnapshot
      }>(`/api/providers/${providerId}/models/test/cancel`, {
        method: 'POST',
        body: jobId != null ? { jobId } : {},
      })
      if (result.cancelled) {
        const kind = result.job?.kind || ensureJob(providerId).kind
        const label = jobLabel(kind)
        toast.add({
          title: result.job
            ? `Cancelling ${label.toLowerCase()} #${result.job.id}`
            : `Cancelling ${label.toLowerCase()}`,
          description: 'Already-tested models keep their results.',
          color: 'neutral',
        })
      }
      if (result.queue) {
        patchJob(providerId, { queue: result.queue })
      }
      return result
    }
    catch (err: unknown) {
      toast.add({
        title: 'Could not cancel model test',
        description: apiErrorMessage(err),
        color: 'error',
      })
      return null
    }
  }

  function isTesting(providerId: string | null | undefined) {
    if (!providerId) {
      return false
    }
    return isActiveStatus(jobs.value[providerId]?.status || 'idle')
  }

  function jobFor(providerId: string | null | undefined) {
    if (!providerId) {
      return emptyJob()
    }
    return jobs.value[providerId] || emptyJob()
  }

  function onModelsUpdate(providerId: string, listener: ModelListener) {
    let set = modelListeners.get(providerId)
    if (!set) {
      set = new Set()
      modelListeners.set(providerId, set)
    }
    set.add(listener)
    return () => {
      set!.delete(listener)
    }
  }

  function onDone(providerId: string, listener: DoneListener) {
    let set = doneListeners.get(providerId)
    if (!set) {
      set = new Set()
      doneListeners.set(providerId, set)
    }
    set.add(listener)
    return () => {
      set!.delete(listener)
    }
  }

  return {
    jobs,
    jobFor,
    isTesting,
    refreshStatus,
    startTest,
    cancelTest,
    subscribe,
    onModelsUpdate,
    onDone,
  }
}
