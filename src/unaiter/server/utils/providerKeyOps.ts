import type { H3Event } from 'h3'
import { normalizeProviderKeyMethod } from './providerKeyMethods'
import {
  findProviderOrThrow,
  readStore,
  toPublicProvider,
  writeStore,
} from './providers'

export function deleteProviderKey(
  providerId: string,
  keyId: string,
  event?: H3Event,
) {
  const providers = readStore(event)
  const provider = findProviderOrThrow(providers, providerId)
  const index = provider.keys.findIndex(item => item.id === keyId)

  if (index === -1) {
    throw createError({ statusCode: 404, statusMessage: 'API key not found' })
  }

  // Remove that one entry only (legacy stores could hold duplicates of an id).
  provider.keys.splice(index, 1)
  provider.updatedAt = new Date().toISOString()
  writeStore(providers, event)
  return { provider: toPublicProvider(provider) }
}

export type MoveProviderKeyOptions = {
  direction?: 'up' | 'down'
  toIndex?: number
}

export function moveProviderKey(
  providerId: string,
  keyId: string,
  options: MoveProviderKeyOptions,
  event?: H3Event,
) {
  const providers = readStore(event)
  const provider = findProviderOrThrow(providers, providerId)
  const index = provider.keys.findIndex(item => item.id === keyId)

  if (index === -1) {
    throw createError({ statusCode: 404, statusMessage: 'API key not found' })
  }

  let target: number
  if (typeof options.toIndex === 'number') {
    target = options.toIndex
    if (!Number.isInteger(target) || target < 0 || target >= provider.keys.length) {
      throw createError({
        statusCode: 400,
        statusMessage: 'toIndex is out of range',
      })
    }
  }
  else if (options.direction === 'up' || options.direction === 'down') {
    target = options.direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= provider.keys.length) {
      throw createError({
        statusCode: 400,
        statusMessage: options.direction === 'up'
          ? 'Key is already at the top'
          : 'Key is already at the bottom',
      })
    }
  }
  else {
    throw createError({
      statusCode: 400,
      statusMessage: 'Provide direction ("up"|"down") or toIndex',
    })
  }

  if (target !== index) {
    const [item] = provider.keys.splice(index, 1)
    provider.keys.splice(target, 0, item)
    provider.updatedAt = new Date().toISOString()
    writeStore(providers, event)
  }

  return { provider: toPublicProvider(provider) }
}

/**
 * Mark a key as exhausted. Behaviour depends on `keyMethod`:
 * - roundabout: move the key to the end of the list
 */
export function exhaustProviderKey(
  providerId: string,
  keyId: string,
  event?: H3Event,
) {
  const providers = readStore(event)
  const provider = findProviderOrThrow(providers, providerId)
  const index = provider.keys.findIndex(item => item.id === keyId)

  if (index === -1) {
    throw createError({ statusCode: 404, statusMessage: 'API key not found' })
  }

  const method = normalizeProviderKeyMethod(provider.keyMethod)
  let moved = false

  if (method === 'roundabout' && index < provider.keys.length - 1) {
    const [item] = provider.keys.splice(index, 1)
    provider.keys.push(item)
    provider.updatedAt = new Date().toISOString()
    writeStore(providers, event)
    moved = true
  }

  return {
    provider: toPublicProvider(provider),
    keyMethod: method,
    moved,
  }
}
