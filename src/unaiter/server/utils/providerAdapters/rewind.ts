/**
 * Rewind.ai OpenAI-compatible API adapter.
 *
 * Chat: `POST https://api.rewind.ai/v1/chat/completions/` (trailing slash).
 * Models: `GET https://api.rewind.ai/v1/models` returns `{ models: [...] }`
 * instead of OpenAI `{ data: [...] }`, with context under
 * `capabilities.contextLength`. This adapter remaps that catalogue into the
 * shape the default OpenAI parser expects — without changing the default path.
 */

import type { ProviderAdapter } from './types'

export const REWIND_ADAPTER_ID = 'rewind'

const REWIND_HOST = 'api.rewind.ai'
const REWIND_CHAT_PATH = '/v1'

/** Hostname hint for presets / docs only — not used to auto-select. */
export function matchRewindBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.replace(/^www\./, '')
    return host === REWIND_HOST || host.endsWith(`.${REWIND_HOST}`)
  }
  catch {
    return /api\.rewind\.ai/i.test(baseUrl)
  }
}

function isKnownRewindPath(pathname: string): boolean {
  return pathname === '/'
    || pathname === ''
    || pathname === '/v1'
    || pathname === '/v1/'
}

/** Normalise stored base URL to `https://api.rewind.ai/v1`. */
export function resolveRewindBaseUrl(baseUrl: string): string {
  const trimmed = (baseUrl || '').replace(/\/+$/, '')
  if (!trimmed) {
    return trimmed
  }

  try {
    const url = new URL(trimmed)
    if (matchRewindBaseUrl(trimmed) && isKnownRewindPath(url.pathname)) {
      url.pathname = REWIND_CHAT_PATH
      url.search = ''
      url.hash = ''
      return url.toString().replace(/\/+$/, '')
    }
  }
  catch {
    // fall through
  }

  return trimmed
}

/** Docs always call chat with a trailing slash. */
export function resolveRewindChatCompletionsUrl(baseUrl: string): string {
  return `${resolveRewindBaseUrl(baseUrl)}/chat/completions/`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Map Rewind catalogue entries onto OpenAI `{ data: [...] }` and lift
 * `capabilities.contextLength` to top-level `context_length`.
 */
export function normalizeRewindModelsPayload(payload: unknown): unknown {
  if (!isPlainObject(payload)) {
    return payload
  }
  if (Array.isArray(payload.data)) {
    return payload
  }
  if (!Array.isArray(payload.models)) {
    return payload
  }

  return {
    object: 'list',
    data: payload.models.map((entry) => {
      if (!isPlainObject(entry)) {
        return entry
      }
      const caps = isPlainObject(entry.capabilities) ? entry.capabilities : null
      const contextLength = caps && typeof caps.contextLength === 'number'
        ? caps.contextLength
        : null
      if (contextLength == null || typeof entry.context_length === 'number') {
        return entry
      }
      return { ...entry, context_length: contextLength }
    }),
  }
}

export function rewindUpstreamHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  return headers
}

export const rewindAdapter: ProviderAdapter = {
  id: REWIND_ADAPTER_ID,
  label: 'Rewind.ai',
  // No `match` — must be selected explicitly in the provider form.
  resolveBaseUrl: resolveRewindBaseUrl,
  resolveChatCompletionsUrl: resolveRewindChatCompletionsUrl,
  normalizeModelsPayload: normalizeRewindModelsPayload,
  resolveApiKey(apiKey) {
    return apiKey
  },
  upstreamHeaders(apiKey) {
    return rewindUpstreamHeaders(apiKey)
  },
  prepareChatBody(body) {
    return { body, forcedStream: false }
  },
  async finalizeChatResponse() {
    return null
  },
}
