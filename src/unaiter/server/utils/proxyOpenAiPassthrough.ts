import type { H3Event } from 'h3'
import { unwrapCustomRouteModelId } from '../../plugins/router/runtime/server/utils/customRoutes'
import { applyAdapterClientResponse } from './providerAdapters/clientResponse'
import { resolveAdapter } from './providerAdapters'
import {
  markKeyExhausted,
  pickProviderKey,
  reloadProvider,
  resolveRoutedModel,
} from './routeModel'

/** Only `/v1/models` is Unaiter-owned (catalogue). Everything else relays. */
const RESERVED_PATHS = new Set(['models'])

function isExhaustedStatus(status: number) {
  return status === 429 || status === 402
}

function upstreamPathFromEvent(event: H3Event): string {
  const raw = getRouterParam(event, 'path') || ''
  return raw.replace(/^\/+|\/+$/g, '')
}

/**
 * OpenAI-compatible passthrough for `/v1/*` except `/v1/models`.
 * Resolves `{providerSlug}/{modelId}`, strips the slug for upstream, and
 * retries Roundabout keys on 429/402.
 *
 * Note: POST `/v1/chat/completions` still hits its dedicated handler first
 * (intent router + provider adapters); this catch-all covers the rest.
 */
export async function proxyOpenAiPassthrough(event: H3Event) {
  const path = upstreamPathFromEvent(event)
  if (!path || RESERVED_PATHS.has(path)) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not found',
    })
  }

  const method = getMethod(event).toUpperCase()
  const hasBody = method !== 'GET' && method !== 'HEAD'

  let body: Record<string, unknown> | null = null
  let publicModelId = ''

  if (hasBody) {
    body = await readBody<Record<string, unknown>>(event) || {}
    publicModelId = typeof body.model === 'string' ? body.model : ''
  }
  else {
    const query = getQuery(event)
    publicModelId = typeof query.model === 'string' ? query.model : ''
  }

  if (!publicModelId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'model is required',
    })
  }

  const routed = resolveRoutedModel(
    unwrapCustomRouteModelId(publicModelId, event),
    event,
  )
  const triedKeyIds = new Set<string>()
  const maxAttempts = Math.max(1, routed.provider.keys.length)
  const adapter = resolveAdapter({
    adapterId: routed.provider.adapterId,
    baseUrl: routed.provider.baseUrl,
  })

  const requestUrl = getRequestURL(event)
  const searchParams = new URLSearchParams(requestUrl.search)
  if (!hasBody) {
    searchParams.set('model', routed.upstreamModelId)
  }
  const search = searchParams.toString()
  const searchSuffix = search ? `?${search}` : ''

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const provider = attempt === 0
      ? routed.provider
      : reloadProvider(routed.provider.id, event)

    const key = provider.keys.length === 0 ? null : pickProviderKey(provider)
    if (key) {
      if (triedKeyIds.has(key.id)) {
        break
      }
      triedKeyIds.add(key.id)
    }

    const baseUrl = adapter.resolveBaseUrl(provider.baseUrl)
    const upstreamUrl = `${baseUrl}/${path}${searchSuffix}`
    const upstreamBody = hasBody && body
      ? JSON.stringify({
          ...body,
          model: routed.upstreamModelId,
        })
      : undefined

    let response: Response
    try {
      response = await fetch(upstreamUrl, {
        method,
        headers: adapter.upstreamHeaders(key?.key || '', {
          modelId: routed.upstreamModelId,
        }),
        body: upstreamBody,
        signal: AbortSignal.timeout(120_000),
      })
    }
    catch {
      if (key) {
        markKeyExhausted(provider.id, key.id, event)
        continue
      }
      throw createError({
        statusCode: 502,
        statusMessage: `Upstream provider "${provider.slug}" is unreachable`,
      })
    }

    if (key && isExhaustedStatus(response.status) && attempt < maxAttempts - 1) {
      markKeyExhausted(provider.id, key.id, event)
      await response.arrayBuffer().catch(() => undefined)
      continue
    }

    const { body: streamBody } = applyAdapterClientResponse(event, adapter, response)
    if (!streamBody) {
      return await response.text()
    }

    return sendStream(event, streamBody)
  }

  throw createError({
    statusCode: 503,
    statusMessage: `All API keys exhausted for provider "${routed.provider.slug}"`,
  })
}
