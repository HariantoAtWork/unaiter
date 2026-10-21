import type { H3Event } from 'h3'
import { listCustomRouteOpenAiModels } from '../../plugins/router/runtime/server/utils/customRoutes'
import { intentRouterModelListItem } from '../../plugins/router/runtime/server/utils/intentRoute'
import { fetchOpenAiCompatibleModels } from './openaiCompatible'
import { newId } from './id'
import type { ModelTask } from './modelTasks'
import {
  findProviderOrThrow,
  readStore,
  toPublicProvider,
  writeStore,
  type Provider,
  type ProviderModel,
} from './providers'

export type ProviderModelPublic = {
  id: string
  modelId: string
  contextLength: number | null
  tasks: ModelTask[]
  enabled: boolean
  source: 'manual' | 'fetched'
  lastTestOk: boolean | null
  testedAt: string | null
  createdAt: string
}

export function toPublicModel(model: ProviderModel): ProviderModelPublic {
  return {
    id: model.id,
    modelId: model.modelId,
    contextLength: typeof model.contextLength === 'number' && model.contextLength > 0
      ? model.contextLength
      : null,
    tasks: Array.isArray(model.tasks) ? [...model.tasks] : [],
    enabled: model.enabled,
    source: model.source,
    lastTestOk: model.lastTestOk,
    testedAt: model.testedAt,
    createdAt: model.createdAt,
  }
}

/** Empty string when the provider has no keys (local AI often needs none). */
function firstUsableKey(provider: Provider) {
  const valid = provider.keys.find(item => item.valid === true)
  if (valid) {
    return valid.key
  }
  return provider.keys[0]?.key || ''
}

function parseBulkModelIds(raw: string) {
  const seen = new Set<string>()
  const ids: string[] = []
  let skippedEmpty = 0
  let skippedDuplicateInPaste = 0

  for (const line of raw.split(/\r?\n/)) {
    const modelId = line.trim()
    if (!modelId || modelId.startsWith('#')) {
      skippedEmpty += 1
      continue
    }
    if (seen.has(modelId)) {
      skippedDuplicateInPaste += 1
      continue
    }
    seen.add(modelId)
    ids.push(modelId)
  }

  return { ids, skippedEmpty, skippedDuplicateInPaste }
}

export function listProviderModels(providerId: string, event?: H3Event) {
  const provider = findProviderOrThrow(readStore(event), providerId)
  return {
    provider: toPublicProvider(provider),
    models: provider.models.map(toPublicModel),
  }
}

export type OpenAiModelListItem = {
  id: string
  object: 'model'
  created: number
  owned_by: string
  /** Provider's own /models fields are copied through, so extra keys are expected. */
  [key: string]: unknown
}

/** Public model id: `{providerSlug}/{modelId}`. */
export function publicModelId(providerSlug: string, modelId: string) {
  return `${providerSlug}/${modelId}`
}

/** Enabled models across providers for OpenAI-compatible GET /v1/models.
 * Whatever the provider advertised in its `/models` entry is copied through;
 * `id`, `object` and `owned_by` stay under our control so routing keeps working. */
export function listEnabledOpenAiModels(event?: H3Event) {
  const providers = readStore(event)
  const seen = new Set<string>()
  const data: OpenAiModelListItem[] = []

  for (const provider of providers) {
    for (const model of provider.models) {
      if (!model.enabled) {
        continue
      }
      const id = publicModelId(provider.slug, model.modelId)
      if (seen.has(id)) {
        continue
      }
      seen.add(id)
      const createdMs = Date.parse(model.createdAt)
      data.push({
        ...(model.providerMeta ?? {}),
        id,
        object: 'model',
        created: Number.isFinite(createdMs) ? Math.floor(createdMs / 1000) : 0,
        owned_by: provider.slug,
        // Verified hats from per-format tests (overrides opaque upstream `tasks` if any).
        ...(model.tasks?.length ? { tasks: model.tasks } : {}),
      })
    }
  }

  const routerModel = intentRouterModelListItem(event)
  if (routerModel && !seen.has(routerModel.id)) {
    data.push(routerModel)
  }

  for (const item of listCustomRouteOpenAiModels(event)) {
    if (seen.has(item.id)) {
      continue
    }
    seen.add(item.id)
    data.push(item)
  }

  data.sort((a, b) => a.id.localeCompare(b.id))

  return {
    object: 'list' as const,
    data,
  }
}

export function addProviderModelsBulk(
  providerId: string,
  raw: string,
  event?: H3Event,
) {
  const providers = readStore(event)
  const provider = findProviderOrThrow(providers, providerId)
  const { ids, skippedDuplicateInPaste } = parseBulkModelIds(raw)

  if (ids.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'At least one model id is required',
    })
  }

  const existing = new Set(provider.models.map(item => item.modelId))
  const now = new Date().toISOString()
  let added = 0
  let skippedExisting = 0

  for (const modelId of ids) {
    if (existing.has(modelId)) {
      skippedExisting += 1
      continue
    }
    existing.add(modelId)
    provider.models.push({
      id: newId(),
      modelId,
      tasks: [],
      enabled: true,
      source: 'manual',
      lastTestOk: null,
      testedAt: null,
      createdAt: now,
    })
    added += 1
  }

  if (added > 0) {
    provider.updatedAt = now
    writeStore(providers, event)
  }

  return {
    provider: toPublicProvider(provider),
    models: provider.models.map(toPublicModel),
    added,
    skippedExisting,
    skippedDuplicateInPaste,
  }
}

export async function fetchProviderModels(providerId: string, event?: H3Event) {
  const providers = readStore(event)
  const provider = findProviderOrThrow(providers, providerId)
  const apiKey = firstUsableKey(provider)
  const remoteModels = await fetchOpenAiCompatibleModels(provider.baseUrl, apiKey, {
    adapterId: provider.adapterId,
  })
  const existing = new Map(provider.models.map(item => [item.modelId, item]))
  const now = new Date().toISOString()
  let added = 0
  let skippedExisting = 0
  let dirty = false

  for (const remote of remoteModels) {
    const current = existing.get(remote.id)
    if (current) {
      skippedExisting += 1
      if (remote.contextLength != null && current.contextLength !== remote.contextLength) {
        current.contextLength = remote.contextLength
        dirty = true
      }
      if (JSON.stringify(current.providerMeta ?? null) !== JSON.stringify(remote.raw)) {
        current.providerMeta = remote.raw
        dirty = true
      }
      continue
    }
    provider.models.push({
      id: newId(),
      modelId: remote.id,
      contextLength: remote.contextLength,
      providerMeta: remote.raw,
      tasks: [],
      enabled: true,
      source: 'fetched',
      lastTestOk: null,
      testedAt: null,
      createdAt: now,
    })
    added += 1
  }

  if (added > 0 || dirty) {
    provider.updatedAt = now
    writeStore(providers, event)
  }

  return {
    provider: toPublicProvider(provider),
    models: provider.models.map(toPublicModel),
    fetched: remoteModels.length,
    added,
    skippedExisting,
  }
}

export function setProviderModelEnabled(
  providerId: string,
  modelRowId: string,
  enabled: boolean,
  event?: H3Event,
) {
  const providers = readStore(event)
  const provider = findProviderOrThrow(providers, providerId)
  const model = provider.models.find(item => item.id === modelRowId)

  if (!model) {
    throw createError({ statusCode: 404, statusMessage: 'Model not found' })
  }

  model.enabled = enabled
  provider.updatedAt = new Date().toISOString()
  writeStore(providers, event)

  return {
    provider: toPublicProvider(provider),
    model: toPublicModel(model),
  }
}

export function deleteProviderModel(
  providerId: string,
  modelRowId: string,
  event?: H3Event,
) {
  const providers = readStore(event)
  const provider = findProviderOrThrow(providers, providerId)
  const before = provider.models.length
  provider.models = provider.models.filter(item => item.id !== modelRowId)

  if (provider.models.length === before) {
    throw createError({ statusCode: 404, statusMessage: 'Model not found' })
  }

  provider.updatedAt = new Date().toISOString()
  writeStore(providers, event)

  return {
    provider: toPublicProvider(provider),
    models: provider.models.map(toPublicModel),
  }
}

export function clearProviderModels(providerId: string, event?: H3Event) {
  const providers = readStore(event)
  const provider = findProviderOrThrow(providers, providerId)
  const removed = provider.models.length
  provider.models = []
  provider.updatedAt = new Date().toISOString()
  writeStore(providers, event)

  return {
    provider: toPublicProvider(provider),
    models: [] as ProviderModelPublic[],
    removed,
  }
}
