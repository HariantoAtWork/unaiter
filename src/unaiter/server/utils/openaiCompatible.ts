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
  if (adapter.resolveModelsUrl) {
    return adapter.resolveModelsUrl(baseUrl)
  }
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
  'max_input_tokens',
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

const TOOLS_PROBE_NAME = 'ping'

function toolsProbeBody(modelId: string): Record<string, unknown> {
  return {
    model: modelId,
    max_tokens: 64,
    messages: [{
      role: 'user',
      content: 'Call the ping tool with message hi. Do not reply with plain text.',
    }],
    tools: [{
      type: 'function',
      function: {
        name: TOOLS_PROBE_NAME,
        description: 'Unaiter tool-support probe',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
          required: ['message'],
        },
      },
    }],
    tool_choice: {
      type: 'function',
      function: { name: TOOLS_PROBE_NAME },
    },
  }
}

function messageHasToolCall(message: unknown): boolean {
  if (!message || typeof message !== 'object') {
    return false
  }
  const record = message as Record<string, unknown>
  if (Array.isArray(record.tool_calls) && record.tool_calls.length > 0) {
    return true
  }
  if (record.function_call && typeof record.function_call === 'object') {
    return true
  }
  return false
}

function completionHasToolCalls(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') {
    return false
  }
  const choices = (payload as { choices?: unknown[] }).choices
  if (!Array.isArray(choices)) {
    return false
  }
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') {
      continue
    }
    const row = choice as Record<string, unknown>
    if (messageHasToolCall(row.message) || messageHasToolCall(row.delta)) {
      return true
    }
    if (row.finish_reason === 'tool_calls' || row.finish_reason === 'function_call') {
      return true
    }
  }
  return false
}

/** Collect tool_calls from an OpenAI SSE chat stream (adapters that force stream). */
function sseHasToolCalls(text: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) {
      continue
    }
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') {
      continue
    }
    try {
      if (completionHasToolCalls(JSON.parse(data))) {
        return true
      }
    }
    catch {
      // ignore malformed SSE lines
    }
  }
  return false
}

/**
 * Probe whether a model accepts tools and returns a tool call when forced.
 * Does not flip enablement — only reports capability.
 */
export async function testOpenAiCompatibleModelTools(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  signal?: AbortSignal,
  options?: AdapterAwareOptions,
): Promise<boolean> {
  const adapter = resolveFor(baseUrl, options)
  const url = `${adapter.resolveBaseUrl(baseUrl)}/chat/completions`
  const key = adapter.resolveApiKey(apiKey, modelId)
  const prepared = adapter.prepareChatBody(toolsProbeBody(modelId))
  const timeout = AbortSignal.timeout(45_000)
  const combined = signal ? AbortSignal.any([timeout, signal]) : timeout

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: adapter.upstreamHeaders(key, { modelId }),
      body: JSON.stringify(prepared.body),
      signal: combined,
    })
    if (!response.ok) {
      return false
    }

    const contentType = response.headers.get('content-type') || ''
    if (prepared.forcedStream || contentType.includes('text/event-stream')) {
      return sseHasToolCalls(await response.text())
    }

    try {
      return completionHasToolCalls(await response.json())
    }
    catch {
      return false
    }
  }
  catch (err) {
    if (signal?.aborted) {
      throw err
    }
    return false
  }
}
