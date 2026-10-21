import type { H3Event } from 'h3'
import type { ProviderAdapter } from './types'

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'content-encoding',
  'content-length',
])

function isHtmlContentType(contentType: string) {
  return /text\/html/i.test(contentType)
}

/**
 * Apply optional adapter header/body rewrites, then set status + headers on the
 * H3 event. Returns the body to stream (or null).
 */
export function applyAdapterClientResponse(
  event: H3Event,
  adapter: ProviderAdapter,
  response: Response,
): { body: ReadableStream<Uint8Array> | null } {
  const contentType = response.headers.get('content-type') || ''

  let status = response.status
  // Specialist adapters that transform bodies should not forward HTML docs as
  // a successful stream (e.g. deprecated bridge → Mintlify redirect).
  if (isHtmlContentType(contentType) && adapter.transformUpstreamBody) {
    status = 502
  }
  setResponseStatus(event, status)

  let headers = new Headers()
  response.headers.forEach((value, name) => {
    if (!HOP_BY_HOP.has(name.toLowerCase())) {
      headers.set(name, value)
    }
  })
  if (adapter.sanitizeClientHeaders) {
    headers = adapter.sanitizeClientHeaders(headers)
  }
  headers.forEach((value, name) => {
    setHeader(event, name, value)
  })

  let body = response.body
  if (body && adapter.transformUpstreamBody) {
    body = adapter.transformUpstreamBody(body, { contentType })
  }

  return { body }
}
