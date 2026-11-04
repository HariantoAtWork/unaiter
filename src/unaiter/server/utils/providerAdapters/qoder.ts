/**
 * Qoder OpenAI-compatible API adapter.
 *
 * Chat completions live on `https://api.qoder.com/v1/chat/completions`.
 * Model discovery for Personal Access Tokens (`pt-*`) lives on the Cloud
 * Agents catalogue (`/api/v1/cloud/models`) — the OpenAI `/v1/models` path
 * rejects PATs with "invalid apikey". Forward (`/api/v1/forward/models`)
 * returns the same catalogue.
 *
 * Operators often paste Cloud/Forward roots as the provider base URL; chat
 * still rewrites those to the `/v1` root. Headers use `User-Agent: Qoder-Cli`,
 * matching the fingerprint qodercli / OmniRoute send on the chat gateway.
 */

import type { ProviderAdapter } from './types'

export const QODER_ADAPTER_ID = 'qoder'

const QODER_HOST = 'api.qoder.com'
const QODER_CN_HOST = 'api.qoder.com.cn'
const QODER_CHAT_PATH = '/v1'
const QODER_MODELS_PATH = '/api/v1/cloud/models'
const QODER_USER_AGENT = 'Qoder-Cli'

/** Hostname hint for migration / presets only — not the source of truth. */
export function matchQoderBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.replace(/^www\./, '')
    return host === QODER_HOST
      || host === QODER_CN_HOST
      || host.endsWith(`.${QODER_HOST}`)
      || host.endsWith(`.${QODER_CN_HOST}`)
  }
  catch {
    return /api\.qoder\.com(\.cn)?/i.test(baseUrl)
  }
}

/**
 * Known mistaken or incomplete path shapes that should land on `/v1`:
 * `/`, `/v1`, `/api/v1`, `/api/v1/cloud`, `/api/v1/forward` (+ trailing slash).
 */
function isKnownQoderPath(pathname: string): boolean {
  return /^\/(api\/)?v1(\/(cloud|forward))?\/?$/.test(pathname)
    || pathname === '/'
    || pathname === ''
}

/**
 * Normalise the stored base URL to the OpenAI-compatible chat root.
 * Unknown hosts / self-hosted proxies are left alone.
 */
export function resolveQoderBaseUrl(baseUrl: string): string {
  const trimmed = (baseUrl || '').replace(/\/+$/, '')
  if (!trimmed) {
    return trimmed
  }

  try {
    const url = new URL(trimmed)
    if (matchQoderBaseUrl(trimmed) && isKnownQoderPath(url.pathname)) {
      url.pathname = QODER_CHAT_PATH
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

/**
 * Model discovery uses the Cloud Agents catalogue.
 * Accepts `pt-*` PATs and returns short ids such as `dmodel` (DeepSeek-V4-Pro).
 */
export function resolveQoderModelsUrl(baseUrl: string): string {
  const chatBase = resolveQoderBaseUrl(baseUrl)
  try {
    const url = new URL(chatBase || baseUrl)
    if (matchQoderBaseUrl(url.origin)) {
      return `${url.origin}${QODER_MODELS_PATH}`
    }
  }
  catch {
    // fall through
  }
  return `${chatBase}/models`
}

export function qoderUpstreamHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': QODER_USER_AGENT,
  }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  return headers
}

export const qoderAdapter: ProviderAdapter = {
  id: QODER_ADAPTER_ID,
  label: 'Qoder',
  // No `match` — must be selected explicitly in the provider form.
  resolveBaseUrl: resolveQoderBaseUrl,
  resolveModelsUrl: resolveQoderModelsUrl,
  resolveApiKey(apiKey) {
    return apiKey
  },
  upstreamHeaders(apiKey) {
    return qoderUpstreamHeaders(apiKey)
  },
  prepareChatBody(body) {
    return { body, forcedStream: false }
  },
  async finalizeChatResponse() {
    return null
  },
}
