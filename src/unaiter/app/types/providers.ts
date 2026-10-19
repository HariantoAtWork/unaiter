export type ProviderKeyMethod = 'roundabout'

export type ProviderKeyPublic = {
  id: string
  hint: string
  valid: boolean | null
  createdAt: string
}

export type ModelTask =
  | 'generate'
  | 'embedding'
  | 'score'
  | 'moderation'
  | 'decision'

export type ProviderModelPublic = {
  id: string
  modelId: string
  contextLength: number | null
  tasks: ModelTask[]
  enabled: boolean
  source: 'manual' | 'fetched'
  lastTestOk: boolean | null
  testedAt: string | null
  createdAt: string
}

export type ProviderPublic = {
  id: string
  name: string
  slug: string
  baseUrl: string
  /** Server adapter id (e.g. default, opencode). */
  adapterId: string
  keyMethod: ProviderKeyMethod
  keyCount: number
  validKeyCount: number
  modelCount: number
  enabledModelCount: number
  keys: ProviderKeyPublic[]
}

export type ProviderAdapterPublic = {
  id: string
  label: string
}

export type ModelStatusFilter = 'all' | 'enabled' | 'disabled'

export type ProviderModelTestSummary = {
  tested: number
  passed: number
  failed: number
  enabled: number
  disabled: number
  total: number
}

export type ProviderModelTestJobPublic = {
  id: number
  providerId: string
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

export type ProviderModelTestStatus = {
  providerId: string
  jobId: number | null
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

export type ProviderModelTestEvent =
  | { type: 'queue', queue: ProviderModelTestQueueSnapshot }
  | {
    type: 'started'
    jobId: number
    providerId: string
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

export const PROVIDER_KEY_METHOD_OPTIONS: Array<{
  label: string
  value: ProviderKeyMethod
  description: string
}> = [
  {
    label: 'Roundabout',
    value: 'roundabout',
    description: 'When a key is exhausted, it moves to the end of the list.',
  },
]

export function providerKeyMethodLabel(method: ProviderKeyMethod | undefined) {
  return PROVIDER_KEY_METHOD_OPTIONS.find(option => option.value === method)?.label
    || 'Roundabout'
}
