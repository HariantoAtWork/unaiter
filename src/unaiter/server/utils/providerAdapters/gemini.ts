/**
 * Google Gemini OpenAI-compatible API adapter.
 *
 * Chat and model discovery live on
 * `https://generativelanguage.googleapis.com/v1beta/openai`.
 * That surface requires `Authorization: Bearer <key>` — `x-goog-api-key` alone
 * returns 400. Catalogue IDs arrive as `models/gemma-4-31b-it`; chat rejects
 * that prefix with HTTP 500, so this adapter strips a leading `models/`.
 */

import type { ProviderAdapter } from './types'

export const GEMINI_ADAPTER_ID = 'gemini'

const GEMINI_HOST = 'generativelanguage.googleapis.com'
const GEMINI_CHAT_PATH = '/v1beta/openai'

/** Hostname hint for migration / presets only — not the source of truth. */
export function matchGeminiBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.replace(/^www\./, '')
    return host === GEMINI_HOST || host.endsWith(`.${GEMINI_HOST}`)
  }
  catch {
    return /generativelanguage\.googleapis\.com/i.test(baseUrl)
  }
}

/**
 * Known roots that should land on `/v1beta/openai`:
 * `/`, `/v1beta`, `/v1beta/openai` (+ trailing slash).
 */
function isKnownGeminiPath(pathname: string): boolean {
  return /^\/(v1beta(\/openai)?)?\/?$/.test(pathname)
    || pathname === '/'
    || pathname === ''
}

/**
 * Normalise the stored base URL to the OpenAI-compatible chat root.
 * Unknown hosts / self-hosted proxies are left alone.
 */
export function resolveGeminiBaseUrl(baseUrl: string): string {
  const trimmed = (baseUrl || '').replace(/\/+$/, '')
  if (!trimmed) {
    return trimmed
  }

  try {
    const url = new URL(trimmed)
    if (matchGeminiBaseUrl(trimmed) && isKnownGeminiPath(url.pathname)) {
      url.pathname = GEMINI_CHAT_PATH
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

/** Strip Google's `models/` catalogue prefix so chat completions accept the id. */
export function normalizeGeminiModelId(modelId: string): string {
  const id = modelId.trim()
  return id.replace(/^models\//, '')
}

export function geminiUpstreamHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  return headers
}

export const geminiAdapter: ProviderAdapter = {
  id: GEMINI_ADAPTER_ID,
  label: 'Google Gemini',
  // No `match` — must be selected explicitly in the provider form.
  resolveBaseUrl: resolveGeminiBaseUrl,
  normalizeModelId: normalizeGeminiModelId,
  resolveApiKey(apiKey) {
    return apiKey
  },
  upstreamHeaders(apiKey) {
    return geminiUpstreamHeaders(apiKey)
  },
  prepareChatBody(body) {
    const model = typeof body.model === 'string' ? body.model : ''
    if (!model) {
      return { body, forcedStream: false }
    }
    const normalised = normalizeGeminiModelId(model)
    if (normalised === model) {
      return { body, forcedStream: false }
    }
    return {
      body: { ...body, model: normalised },
      forcedStream: false,
    }
  },
  async finalizeChatResponse() {
    return null
  },
}
