/**
 * Baseten Model APIs adapter.
 *
 * Cursor (and strict OpenAI SSE clients) reconnect when Baseten streams full
 * `usage` on every chunk and a trailer with `choices: []`. This adapter keeps
 * the default relay for other providers and only normalises Baseten responses.
 */

import type { ProviderAdapter } from './types'

export const BASETEN_ADAPTER_ID = 'baseten'

const SSE_CONTENT_TYPE = 'text/event-stream; charset=utf-8'
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8'

const HEADER_ALLOW = new Set([
  'content-type',
  'cache-control',
])

function isRateLimitHeader(name: string) {
  return name.startsWith('x-ratelimit-')
}

function isHtmlContentType(contentType: string) {
  return /text\/html/i.test(contentType)
}

function isEventStreamContentType(contentType: string) {
  return /text\/event-stream/i.test(contentType)
}

export function resolveBasetenBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

export function sanitizeBasetenClientHeaders(headers: Headers): Headers {
  const out = new Headers()
  headers.forEach((value, name) => {
    const lower = name.toLowerCase()
    if (HEADER_ALLOW.has(lower) || isRateLimitHeader(lower)) {
      out.set(name, value)
    }
  })

  const upstreamType = headers.get('content-type') || ''
  if (isHtmlContentType(upstreamType)) {
    out.set('content-type', JSON_CONTENT_TYPE)
  }
  else if (isEventStreamContentType(upstreamType)) {
    // Upstream often omits charset; Cursor-friendly clients expect utf-8.
    out.set('content-type', SSE_CONTENT_TYPE)
  }

  return out
}

function htmlGuardBody(): ReadableStream<Uint8Array> {
  const payload = JSON.stringify({
    error: {
      message: 'Upstream returned HTML instead of an API response (check Baseten base URL)',
      type: 'upstream_error',
      code: '502',
    },
  })
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload))
      controller.close()
    },
  })
}

/**
 * Normalise Baseten chat/completions SSE toward OpenAI-ish streams:
 * - null out mid-stream `usage` when choices are present
 * - drop empty `choices: []` trailer frames (keep `[DONE]`)
 */
export function transformBasetenSseStream(
  body: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''

  return new ReadableStream({
    async start(controller) {
      const reader = body.getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) {
            break
          }
          buffer += decoder.decode(value, { stream: true })
          buffer = flushSseBuffer(buffer, controller, encoder, false)
        }
        buffer += decoder.decode()
        flushSseBuffer(buffer, controller, encoder, true)
        controller.close()
      }
      catch (error) {
        controller.error(error)
      }
      finally {
        reader.releaseLock()
      }
    },
  })
}

function flushSseBuffer(
  buffer: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  flushAll: boolean,
): string {
  const parts = buffer.split(/\r?\n/)
  // Keep the last partial line unless we are finishing.
  const complete = flushAll ? parts : parts.slice(0, -1)
  const rest = flushAll ? '' : (parts[parts.length - 1] ?? '')

  for (const line of complete) {
    const rewritten = rewriteSseLine(line)
    if (rewritten === null) {
      continue
    }
    controller.enqueue(encoder.encode(`${rewritten}\n`))
  }

  return rest
}

/** Return null to drop the line; otherwise the line to emit (no trailing newline). */
function rewriteSseLine(line: string): string | null {
  if (!line.startsWith('data:')) {
    return line
  }

  const payload = line.slice(5).trim()
  if (!payload) {
    return null
  }
  if (payload === '[DONE]') {
    return 'data: [DONE]'
  }

  // Preserve exact "data: " vs "data:" spacing as "data: …"
  let parsed: {
    choices?: unknown[]
    usage?: unknown
  }
  try {
    parsed = JSON.parse(payload) as { choices?: unknown[], usage?: unknown }
  }
  catch {
    return line
  }

  if (Array.isArray(parsed.choices) && parsed.choices.length === 0) {
    // Usage-only trailer — Cursor treats this poorly.
    return null
  }

  if (Array.isArray(parsed.choices) && parsed.choices.length > 0 && 'usage' in parsed) {
    parsed.usage = null
    return `data: ${JSON.stringify(parsed)}`
  }

  return line
}

export function transformBasetenUpstreamBody(
  body: ReadableStream<Uint8Array>,
  ctx: { contentType: string },
): ReadableStream<Uint8Array> {
  if (isHtmlContentType(ctx.contentType)) {
    return htmlGuardBody()
  }
  if (isEventStreamContentType(ctx.contentType)) {
    return transformBasetenSseStream(body)
  }
  return body
}

export const basetenAdapter: ProviderAdapter = {
  id: BASETEN_ADAPTER_ID,
  label: 'Baseten Model APIs',
  // No `match` — must be selected explicitly in the provider form.
  resolveBaseUrl: resolveBasetenBaseUrl,
  resolveApiKey(apiKey) {
    return apiKey
  },
  upstreamHeaders(apiKey) {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
    }
    return headers
  },
  prepareChatBody(body) {
    return { body, forcedStream: false }
  },
  async finalizeChatResponse() {
    return null
  },
  sanitizeClientHeaders: sanitizeBasetenClientHeaders,
  transformUpstreamBody: transformBasetenUpstreamBody,
}
