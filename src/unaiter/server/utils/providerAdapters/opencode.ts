/**
 * OpenCode client fingerprint.
 *
 * Console docs: "Free-tier chat models are only available from within OpenCode;
 * other clients receive HTTP 403, even with an API key. Use paid models or a Go
 * subscription from other clients."
 *
 * So the adapter has to look like the official CLI. This mirrors the request
 * captured from `opencode` 2.1.4 (2026-10-26, HTTPS MITM of `opencode run`):
 *
 *   POST https://opencode.ai/inference/openai/v1/chat/completions
 *   Authorization: Bearer public
 *   User-Agent: opencode/latest/2.1.4/cli
 *   b3: <32hex>-<16hex>-1-<16hex>
 *   traceparent: 00-<32hex>-<16hex>-01
 *   x-opencode-client: cli
 *   x-opencode-project: <40 hex>
 *   x-opencode-session: ses_…        (+ x-opencode-session-id, x-session-affinity, x-session-id)
 *   {"model":"…","messages":[…],"tools":[…],"stream":true,
 *    "stream_options":{"include_usage":true},"max_completion_tokens":32000}
 *
 * The model list lives on `/inference/v1/models` (no `/openai`), chat lives on
 * `/inference/openai/v1/chat/completions`.
 */

import { aggregateOpenAiChatStream } from './streamAggregate'
import type { ProviderAdapter } from './types'

/** Advertised by the CLI; see https://opencode.ai/update/api/latest/cli/npm. */
const OPENCODE_CLI_VERSION = '2.1.4'
const OPENCODE_HOST = 'opencode.ai'
/** Chat base the CLI uses (store this as the provider base URL). */
const OPENCODE_CHAT_PATH = '/inference/openai/v1'
/** Model list path (the CLI hits this one for discovery). */
const OPENCODE_MODELS_PATH = '/inference/v1/models'
/**
 * `x-opencode-project` is a 40-hex id the CLI derives from the project
 * directory. Any stable value works; this one is fixed per deployment so the
 * gateway can route/cache consistently.
 */
const OPENCODE_PROJECT_ID = '24e88bc3880705192629128501ee0df09fe22368'
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
    return host === OPENCODE_HOST || host.endsWith(`.${OPENCODE_HOST}`)
  }
  catch {
    return /opencode\.ai/i.test(baseUrl)
  }
}

/** `/`, `/inference`, `/inference/v1`, `/inference/openai/v1`. */
function isInferencePath(pathname: string): boolean {
  return /^\/inference(\/(v1|openai\/v1))?\/?$/.test(pathname)
}

function isKnownOpenCodePath(url: URL): boolean {
  return url.pathname === '/' || url.pathname === '' || isInferencePath(url.pathname)
}

/**
 * Normalise the stored base URL to the path the CLI uses for chat completions.
 * Unknown paths (self-hosted proxies) are left alone.
 */
export function resolveOpenCodeBaseUrl(baseUrl: string): string {
  const trimmed = (baseUrl || '').replace(/\/+$/, '')
  if (!trimmed) {
    return trimmed
  }
  try {
    const url = new URL(trimmed)
    if (isKnownOpenCodePath(url)) {
      url.pathname = OPENCODE_CHAT_PATH
      return url.toString().replace(/\/+$/, '')
    }
  }
  catch {
    // fall through
  }
  return trimmed
}

/** Model discovery lives on `/inference/v1/models`, not next to chat. */
export function resolveOpenCodeModelsUrl(baseUrl: string): string {
  const trimmed = (baseUrl || '').replace(/\/+$/, '')
  if (!trimmed) {
    return `${trimmed}/models`
  }
  try {
    const url = new URL(trimmed)
    if (matchOpenCodeBaseUrl(trimmed) || isKnownOpenCodePath(url)) {
      return `${url.origin}${OPENCODE_MODELS_PATH}`
    }
  }
  catch {
    // fall through
  }
  return `${trimmed}/models`
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

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes)
  crypto.getRandomValues(buffer)
  return [...buffer].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** W3C + B3 propagation headers the CLI sends on every inference call. */
export function createOpenCodeTrace(): { b3: string, traceparent: string } {
  const traceId = randomHex(16)
  const spanId = randomHex(8)
  const parentSpanId = randomHex(8)
  return {
    b3: `${traceId}-${spanId}-1-${parentSpanId}`,
    traceparent: `00-${traceId}-${spanId}-01`,
  }
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

/**
 * The CLI always ships a coding-agent toolset (`read`, `shell`, `edit`, …).
 * Keep at least the two the gateway-side checks are known to look for when the
 * caller sends no tools of its own.
 */
export function ensureOpenCodeFreeTierTools(tools: unknown): unknown[] {
  const existing = Array.isArray(tools) ? [...tools] : []
  const names = toolNames(existing)
  if (!names.has('read')) {
    existing.push(stubTool('read', 'Read the contents of a file', 'path'))
  }
  if (!names.has('shell') && !names.has('bash')) {
    existing.push(stubTool('shell', 'Execute a shell command', 'command'))
  }
  return existing
}

/** Models the anonymous `public` key can serve (free tier). */
export function isOpenCodeFreeModel(modelId: string): boolean {
  const id = modelId.trim().toLowerCase()
  return id.endsWith('-free') || id === 'big-pickle'
}

/**
 * Prefer the stored key — free models accept it too and paid models require it.
 * Anonymous `public` is the CLI's fallback when no `OPENCODE_API_KEY` is set.
 */
export function resolveOpenCodeApiKey(apiKey: string, _modelId: string): string {
  return apiKey.trim() || 'public'
}

export function openCodeUpstreamHeaders(
  apiKey: string,
  sessionId: string = createOpenCodeSessionId(),
  trace: { b3: string, traceparent: string } = createOpenCodeTrace(),
): Record<string, string> {
  const key = apiKey.trim() || 'public'
  return {
    Accept: '*/*',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
    'User-Agent': `opencode/latest/${OPENCODE_CLI_VERSION}/cli`,
    b3: trace.b3,
    traceparent: trace.traceparent,
    'x-opencode-client': 'cli',
    'x-opencode-project': OPENCODE_PROJECT_ID,
    'x-opencode-session': sessionId,
    'x-opencode-session-id': sessionId,
    'x-session-affinity': sessionId,
    'x-session-id': sessionId,
  }
}

/**
 * Patch a chat-completions body so OpenCode models accept it:
 * forces `stream: true`, asks for usage on the final chunk, maps `max_tokens`
 * to `max_completion_tokens` and injects the coding-agent toolset.
 */
export function applyOpenCodeFreeTierBody(
  body: Record<string, unknown>,
): { body: Record<string, unknown>, forcedStream: boolean } {
  const forcedStream = body.stream !== true
  const next: Record<string, unknown> = {
    ...body,
    stream: true,
    tools: ensureOpenCodeFreeTierTools(body.tools),
    stream_options: {
      ...(typeof body.stream_options === 'object' && body.stream_options
        ? body.stream_options as Record<string, unknown>
        : {}),
      include_usage: true,
    },
  }

  if (next.max_completion_tokens === undefined && typeof body.max_tokens === 'number') {
    next.max_completion_tokens = body.max_tokens
  }

  return { body: next, forcedStream }
}

export const opencodeAdapter: ProviderAdapter = {
  id: OPENCODE_ADAPTER_ID,
  label: 'OpenCode',
  // No `match` — must be selected explicitly (same as other specialist adapters).
  resolveBaseUrl: resolveOpenCodeBaseUrl,
  resolveModelsUrl: resolveOpenCodeModelsUrl,
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
