/**
 * OpenCode free-tier client fingerprint.
 *
 * The gateway rejects free models unless the request looks like the official
 * OpenCode client: User-Agent `opencode/<semver>`, an `ses_`-shaped session id,
 * `stream: true`, and tools that include at least `bash` + `read`.
 *
 * See anomalyco/opencode#49433 and related free-tier gate discussions.
 */

import { aggregateOpenAiChatStream } from './streamAggregate'
import type { ProviderAdapter } from './types'

const OPENCODE_UA_VERSION = '1.19.3'
/** Same alphabet OpenCode uses in `bZ` (A–Z, a–z, 0–9). */
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const ID_RANDOM_BYTES = 14

let lastIdMs = 0
let idCounter = 0

export const OPENCODE_ADAPTER_ID = 'opencode'

/** Hostname hint for migration / presets only — not the source of truth. */
export function matchOpenCodeBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.replace(/^www\./, '')
    return host === 'opencode.ai' || host.endsWith('.opencode.ai')
  }
  catch {
    return /opencode\.ai/i.test(baseUrl)
  }
}

/**
 * Keep the request host (proxy-safe). Only normalise the known path quirk:
 * `/inference/openai/v1` → `/inference/v1` (models list lives on the latter).
 */
export function resolveOpenCodeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  try {
    const url = new URL(trimmed)
    if (/\/inference\/openai(\/|$)/.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/inference\/openai(\/|$)/, '/inference$1')
      return url.toString().replace(/\/+$/, '')
    }
  }
  catch {
    // fall through
  }
  return trimmed
}

/**
 * Mirror of OpenCode's `Ume()` / `bZ(true)` session id:
 * `ses_` + 12 hex from `~(Date.now()*0x1000 + counter)` low 48 bits + 14 base62.
 */
export function createOpenCodeSessionId(nowMs: number = Date.now()): string {
  if (nowMs !== lastIdMs) {
    lastIdMs = nowMs
    idCounter = 0
  }
  idCounter += 1

  const stamped = BigInt(nowMs) * 0x1000n + BigInt(idCounter)
  // Session ids use the descending form (`~stamped`); other ids use ascending.
  const value = ~stamped
  let hex = ''
  for (let i = 0; i < 6; i += 1) {
    const byte = Number((value >> BigInt(40 - 8 * i)) & 0xffn)
    hex += byte.toString(16).padStart(2, '0')
  }

  const random = new Uint8Array(ID_RANDOM_BYTES)
  crypto.getRandomValues(random)
  let suffix = ''
  for (const byte of random) {
    suffix += BASE62[byte % 62]!
  }
  return `ses_${hex}${suffix}`
}

function toolNames(tools: unknown): Set<string> {
  const names = new Set<string>()
  if (!Array.isArray(tools)) {
    return names
  }
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') {
      continue
    }
    const entry = tool as { function?: { name?: string }, name?: string }
    const name = entry.function?.name || entry.name
    if (typeof name === 'string' && name) {
      names.add(name)
    }
  }
  return names
}

function stubTool(name: string, description: string, property: string) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties: { [property]: { type: 'string' } },
      },
    },
  }
}

/** Ensure bash + read are present (minimum free-tier toolset). */
export function ensureOpenCodeFreeTierTools(tools: unknown): unknown[] {
  const existing = Array.isArray(tools) ? [...tools] : []
  const names = toolNames(existing)
  if (!names.has('bash')) {
    existing.push(stubTool('bash', 'Run a shell command', 'command'))
  }
  if (!names.has('read')) {
    existing.push(stubTool('read', 'Read a file', 'path'))
  }
  return existing
}

/** Models the anonymous `public` key can serve (free tier). */
export function isOpenCodeFreeModel(modelId: string): boolean {
  const id = modelId.trim().toLowerCase()
  return id.endsWith('-free') || id === 'big-pickle'
}

/**
 * Prefer anonymous `public` for free models — stored keys may be read-only
 * Console keys that cannot call models.
 */
export function resolveOpenCodeApiKey(apiKey: string, modelId: string): string {
  if (isOpenCodeFreeModel(modelId)) {
    return 'public'
  }
  return apiKey.trim() || 'public'
}

export function openCodeUpstreamHeaders(
  apiKey: string,
  sessionId: string = createOpenCodeSessionId(),
): Record<string, string> {
  const key = apiKey.trim() || 'public'
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
    'User-Agent': `opencode/${OPENCODE_UA_VERSION}`,
    'x-opencode-client': 'cli',
    'x-opencode-session': sessionId,
    'x-opencode-project': 'global',
  }
}

/**
 * Patch a chat-completions body so free-tier OpenCode models accept it.
 * Forces `stream: true` and injects bash/read tools when missing.
 */
export function applyOpenCodeFreeTierBody(
  body: Record<string, unknown>,
): { body: Record<string, unknown>, forcedStream: boolean } {
  const forcedStream = body.stream !== true
  return {
    body: {
      ...body,
      stream: true,
      tools: ensureOpenCodeFreeTierTools(body.tools),
    },
    forcedStream,
  }
}

export const opencodeAdapter: ProviderAdapter = {
  id: OPENCODE_ADAPTER_ID,
  label: 'OpenCode',
  // No `match` — must be selected explicitly (same as other specialist adapters).
  resolveBaseUrl: resolveOpenCodeBaseUrl,
  resolveApiKey: resolveOpenCodeApiKey,
  upstreamHeaders(apiKey, ctx) {
    const modelId = ctx?.modelId || ''
    return openCodeUpstreamHeaders(resolveOpenCodeApiKey(apiKey, modelId))
  },
  prepareChatBody: applyOpenCodeFreeTierBody,
  async finalizeChatResponse(response, ctx) {
    if (!ctx.forcedStream || !response.ok || !response.body) {
      return null
    }
    return aggregateOpenAiChatStream(response)
  },
}
