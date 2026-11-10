import type { H3Event } from 'h3'
import { exhaustProviderKey } from './providerKeyOps'
import {
  findProviderOrThrow,
  readStore,
  type Provider,
  type ProviderKey,
  type ProviderModel,
} from './providers'
import { normalizeProviderKeyMethod } from './providerKeyMethods'

export type RoutedModel = {
  provider: Provider
  model: ProviderModel
  /** Upstream model id (without provider slug prefix). */
  upstreamModelId: string
  publicModelId: string
}

/**
 * Public id format: `{providerSlug}/{modelId}`.
 * Only the first `/` separates slug from model id (model ids may contain `/`).
 */
export function parseRoutedModelId(publicId: string) {
  const trimmed = publicId.trim()
  const slash = trimmed.indexOf('/')
  if (slash <= 0 || slash === trimmed.length - 1) {
    return null
  }
  return {
    slug: trimmed.slice(0, slash),
    modelId: trimmed.slice(slash + 1),
  }
}

export function resolveRoutedModel(
  publicModelId: string,
  event?: H3Event,
  allowDisabled = false,
): RoutedModel {
  const parsed = parseRoutedModelId(publicModelId)
  if (!parsed) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Model id must be "{providerSlug}/{modelId}"',
    })
  }

  const providers = readStore(event)
  const provider = providers.find(item => item.slug === parsed.slug)
  if (!provider) {
    throw createError({
      statusCode: 404,
      statusMessage: `Unknown provider slug "${parsed.slug}"`,
    })
  }
  if (provider.enabled === false && !allowDisabled) {
    throw createError({
      statusCode: 404,
      statusMessage: `Provider "${parsed.slug}" is disabled`,
    })
  }

  const model = provider.models.find(item => item.modelId === parsed.modelId)
  if (!model) {
    throw createError({
      statusCode: 404,
      statusMessage: `Model "${parsed.modelId}" not found on provider "${parsed.slug}"`,
    })
  }
  if (!model.enabled && !allowDisabled) {
    throw createError({
      statusCode: 404,
      statusMessage: `Model "${publicModelId}" is disabled`,
    })
  }

  return {
    provider,
    model,
    upstreamModelId: parsed.modelId,
    publicModelId: `${parsed.slug}/${parsed.modelId}`,
  }
}

/** Roundabout: use the first key in the ordered list. */
export function pickProviderKey(provider: Provider): ProviderKey {
  const method = normalizeProviderKeyMethod(provider.keyMethod)
  if (method === 'roundabout') {
    const key = provider.keys[0]
    if (!key) {
      throw createError({
        statusCode: 503,
        statusMessage: `Provider "${provider.slug}" has no API keys`,
      })
    }
    return key
  }

  throw createError({
    statusCode: 500,
    statusMessage: `Unsupported key method "${method}"`,
  })
}

export function markKeyExhausted(
  providerId: string,
  keyId: string,
  event?: H3Event,
) {
  return exhaustProviderKey(providerId, keyId, event)
}

/** Reload provider after store mutations (e.g. exhaust). */
export function reloadProvider(providerId: string, event?: H3Event) {
  return findProviderOrThrow(readStore(event), providerId)
}
