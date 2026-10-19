import {
  minimalProbeBody,
  parseAdvertisedTask,
  probeOrderForAdvertisedTask,
  MODEL_TASK_SPECS,
  type ModelTask,
} from './modelTasks'
import { resolveAdapter } from './providerAdapters'

export type AdapterAwareOptions = {
  adapterId?: string | null
}

function resolveFor(baseUrl: string, options?: AdapterAwareOptions) {
  return resolveAdapter({ adapterId: options?.adapterId, baseUrl })
}

function modelsUrl(baseUrl: string, options?: AdapterAwareOptions) {
  const adapter = resolveFor(baseUrl, options)
  return `${adapter.resolveBaseUrl(baseUrl)}/models`
}

export async function validateOpenAiCompatibleKey(
  baseUrl: string,
  apiKey: string,
  options?: AdapterAwareOptions,
): Promise<boolean> {
  const adapter = resolveFor(baseUrl, options)
  const url = modelsUrl(baseUrl, options)

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: adapter.upstreamHeaders(apiKey),
      signal: AbortSignal.timeout(12_000),
    })
    return response.ok
  }
  catch {
    return false
  }
}

export type BaseUrlProbeResult = {
  ok: boolean
  status: number | null
  modelCount: number | null
  error: string | null
}

/** Probe a base URL for availability without persisting anything. */
export async function probeOpenAiCompatibleBaseUrl(
  baseUrl: string,
  apiKey: string,
  options?: AdapterAwareOptions,
): Promise<BaseUrlProbeResult> {
  const adapter = resolveFor(baseUrl, options)
  const url = modelsUrl(baseUrl, options)

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: adapter.upstreamHeaders(apiKey),
      signal: AbortSignal.timeout(12_000),
    })

    let modelCount: number | null = null
    if (response.ok) {
      try {
        const payload = await response.json() as { data?: Array<{ id?: string }> }
        modelCount = Array.isArray(payload.data) ? payload.data.length : null
      }
      catch {
        modelCount = null
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      modelCount,
      error: response.ok ? null : `Endpoint returned ${response.status}`,
    }
  }
  catch (err) {
    const message = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
      ? 'Request timed out'
      : 'Could not reach the endpoint'
    return { ok: false, status: null, modelCount: null, error: message }
  }
}

export type FetchedModel = {
  id: string
  /** Context window in tokens when the provider advertises one. */
  contextLength: number | null
  /** Raw /models entry, passed through so no provider field is lost. */
  raw: Record<string, unknown>
}

/** Preferred key names, checked before a heuristic scan of the entry. */
const CONTEXT_LENGTH_KEYS = [
  'context_length',
  'max_context_length',
  'context_size',
  'context_window',
  'max_model_len',
  'max_position_embeddings',
] as const

/** Key names that plausibly mean "context window" on any provider. */
const CONTEXT_KEY_PATTERN = /(?:context|model)[_-]?(?:len|length|size|window)/i

function isPositiveTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** Best-effort context length from OpenAI-compatible /models entries
 * (OpenRouter, Together, vLLM, …): known keys first, then any context-ish numeric field. */
function parseContextLength(entry: Record<string, unknown>): number | null {
  for (const key of CONTEXT_LENGTH_KEYS) {
    if (isPositiveTokenCount(entry[key])) {
      return entry[key]
    }
  }
  for (const [key, value] of Object.entries(entry)) {
    if (CONTEXT_KEY_PATTERN.test(key) && isPositiveTokenCount(value)) {
      return value
    }
  }
  return null
}

export async function fetchOpenAiCompatibleModels(
  baseUrl: string,
  apiKey: string,
  options?: AdapterAwareOptions,
): Promise<FetchedModel[]> {
  const adapter = resolveFor(baseUrl, options)
  const url = modelsUrl(baseUrl, options)

  const response = await fetch(url, {
    method: 'GET',
    headers: adapter.upstreamHeaders(apiKey),
    signal: AbortSignal.timeout(20_000),
  })

  if (!response.ok) {
    throw createError({
      statusCode: 502,
      statusMessage: `Provider /models returned ${response.status}`,
    })
  }

  const payload = await response.json() as {
    data?: Array<Record<string, unknown>>
  }

  const seen = new Set<string>()
  const models: FetchedModel[] = []

  for (const item of payload.data || []) {
    const id = typeof item?.id === 'string' ? item.id.trim() : ''
    if (!id || seen.has(id)) {
      continue
    }
    seen.add(id)
    models.push({ id, contextLength: parseContextLength(item), raw: item })
  }

  return models
}

export type ModelFormatTestResult = {
  tasks: ModelTask[]
  ok: boolean
}

const PATH_BY_TASK = new Map(MODEL_TASK_SPECS.map(spec => [spec.task, spec.path]))

async function probeOneFormat(
  task: ModelTask,
  baseUrl: string,
  apiKey: string,
  modelId: string,
  cancel?: AbortSignal,
  options?: AdapterAwareOptions,
): Promise<boolean> {
  const adapter = resolveFor(baseUrl, options)
  const path = PATH_BY_TASK.get(task)
  if (!path) {
    return false
  }

  const url = `${adapter.resolveBaseUrl(baseUrl)}/${path}`
  const key = adapter.resolveApiKey(apiKey, modelId)
  let body = minimalProbeBody(task, modelId)
  if (task === 'generate') {
    body = adapter.prepareChatBody(body).body
  }

  const timeout = AbortSignal.timeout(30_000)
  const combined = cancel ? AbortSignal.any([timeout, cancel]) : timeout

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: adapter.upstreamHeaders(key, { modelId }),
      body: JSON.stringify(body),
      signal: combined,
    })
    return response.ok
  }
  catch (err) {
    // Only surface cancel; per-format timeouts count as a failed probe.
    if (cancel?.aborted) {
      throw err
    }
    return false
  }
}

/**
 * Probe each API format to learn which hats the model wears.
 * Advertised `providerMeta.task` runs first (`chat` alias → `generate`); missing/null → start with `generate`.
 */
export async function testOpenAiCompatibleModelFormats(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  providerMeta?: Record<string, unknown> | null,
  signal?: AbortSignal,
  options?: AdapterAwareOptions,
): Promise<ModelFormatTestResult> {
  const advertised = parseAdvertisedTask(providerMeta?.task)
  const order = probeOrderForAdvertisedTask(advertised)
  const passed: ModelTask[] = []

  for (const task of order) {
    if (signal?.aborted) {
      break
    }
    const ok = await probeOneFormat(task, baseUrl, apiKey, modelId, signal, options)
    if (ok) {
      passed.push(task)
    }
  }

  return { tasks: passed, ok: passed.length > 0 }
}

/** @deprecated Prefer testOpenAiCompatibleModelFormats — chat-only probe. */
export async function testOpenAiCompatibleModel(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  signal?: AbortSignal,
  options?: AdapterAwareOptions,
): Promise<boolean> {
  const result = await testOpenAiCompatibleModelFormats(
    baseUrl,
    apiKey,
    modelId,
    null,
    signal,
    options,
  )
  return result.ok
}
