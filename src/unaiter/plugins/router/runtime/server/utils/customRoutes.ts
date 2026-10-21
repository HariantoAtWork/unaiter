import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { H3Event } from 'h3'
import { ensureDataRoot } from '../../../../../server/utils/dataRoot'
import { newId } from '../../../../../server/utils/id'
import {
  publicModelId,
} from '../../../../../server/utils/providerModels'
import { readStore } from '../../../../../server/utils/providers'
import { slugify } from '../../../../../server/utils/slug'
import type {
  CatalogueModel,
  CustomRoute,
  CustomRoutePublic,
} from '../../shared/types'

const STORE_FILENAME = 'custom-routes.json'

function storePath(event?: H3Event) {
  return join(ensureDataRoot(event), STORE_FILENAME)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeModelIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const seen = new Set<string>()
  const ids: string[] = []
  for (const item of raw) {
    if (!isNonEmptyString(item)) {
      continue
    }
    const id = item.trim()
    if (seen.has(id)) {
      continue
    }
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function normalizeRoute(raw: unknown): CustomRoute | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const input = raw as Record<string, unknown>
  if (!isNonEmptyString(input.id) || !isNonEmptyString(input.name)) {
    return null
  }
  const slug = isNonEmptyString(input.slug)
    ? slugify(input.slug)
    : slugify(input.name)
  if (!slug) {
    return null
  }
  const now = new Date().toISOString()
  return {
    id: input.id.trim(),
    name: input.name.trim(),
    slug,
    modelIds: normalizeModelIds(input.modelIds),
    createdAt: isNonEmptyString(input.createdAt) ? input.createdAt : now,
    updatedAt: isNonEmptyString(input.updatedAt) ? input.updatedAt : now,
  }
}

export function readCustomRoutes(event?: H3Event): CustomRoute[] {
  const path = storePath(event)
  if (!existsSync(path)) {
    return []
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { routes?: unknown }
    const rawRoutes = Array.isArray(parsed?.routes) ? parsed.routes : []
    return rawRoutes
      .map(normalizeRoute)
      .filter((route): route is CustomRoute => route !== null)
  }
  catch {
    return []
  }
}

function writeCustomRoutes(routes: CustomRoute[], event?: H3Event) {
  const path = storePath(event)
  writeFileSync(
    path,
    `${JSON.stringify({ routes }, null, 2)}\n`,
    { mode: 0o600 },
  )
}

/** Map of public provider model id → enabled flag (only models that still exist). */
export function providerModelEnabledMap(event?: H3Event): Map<string, boolean> {
  const map = new Map<string, boolean>()
  for (const provider of readStore(event)) {
    for (const model of provider.models) {
      map.set(publicModelId(provider.slug, model.modelId), model.enabled)
    }
  }
  return map
}

export function toPublicCustomRoute(
  route: CustomRoute,
  enabledMap?: Map<string, boolean>,
): CustomRoutePublic {
  const map = enabledMap ?? providerModelEnabledMap()
  // Total = attached list length. Enabled only counts models that still exist
  // on a provider and are enabled (deleted/missing ones drop out of enabled).
  let enabledModelCount = 0
  for (const id of route.modelIds) {
    if (map.get(id) === true) {
      enabledModelCount += 1
    }
  }
  return {
    ...route,
    modelCount: route.modelIds.length,
    enabledModelCount,
  }
}

export function listCustomRoutesPublic(event?: H3Event): CustomRoutePublic[] {
  const enabledMap = providerModelEnabledMap(event)
  return readCustomRoutes(event)
    .map(route => toPublicCustomRoute(route, enabledMap))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function findCustomRouteById(id: string, event?: H3Event) {
  return readCustomRoutes(event).find(route => route.id === id) ?? null
}

export function findCustomRouteBySlug(slug: string, event?: H3Event) {
  const normalized = slugify(slug)
  if (!normalized) {
    return null
  }
  return readCustomRoutes(event).find(route => route.slug === normalized) ?? null
}

export function listCatalogueModels(event?: H3Event): CatalogueModel[] {
  const models: CatalogueModel[] = []
  for (const provider of readStore(event)) {
    for (const model of provider.models) {
      models.push({
        id: publicModelId(provider.slug, model.modelId),
        enabled: model.enabled,
        providerName: provider.name,
        providerSlug: provider.slug,
      })
    }
  }
  models.sort((a, b) => a.id.localeCompare(b.id))
  return models
}

function assertUniqueSlug(slug: string, routes: CustomRoute[], excludeId?: string) {
  if (routes.some(route => route.slug === slug && route.id !== excludeId)) {
    throw createError({
      statusCode: 409,
      statusMessage: `Route slug "${slug}" is already in use`,
    })
  }
}

export function createCustomRoute(
  input: { name: string, slug?: string, modelIds?: string[] },
  event?: H3Event,
): CustomRoutePublic {
  const name = input.name?.trim()
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'Name is required' })
  }
  const slug = slugify(input.slug?.trim() || name)
  if (!slug) {
    throw createError({ statusCode: 400, statusMessage: 'Slug is required' })
  }

  const routes = readCustomRoutes(event)
  assertUniqueSlug(slug, routes)

  const now = new Date().toISOString()
  const route: CustomRoute = {
    id: newId(),
    name,
    slug,
    modelIds: normalizeModelIds(input.modelIds),
    createdAt: now,
    updatedAt: now,
  }
  routes.push(route)
  writeCustomRoutes(routes, event)
  return toPublicCustomRoute(route, providerModelEnabledMap(event))
}

export function updateCustomRoute(
  id: string,
  input: { name?: string, slug?: string, modelIds?: string[] },
  event?: H3Event,
): CustomRoutePublic {
  const routes = readCustomRoutes(event)
  const index = routes.findIndex(route => route.id === id)
  if (index === -1) {
    throw createError({ statusCode: 404, statusMessage: 'Route not found' })
  }

  const current = routes[index]!
  const name = isNonEmptyString(input.name) ? input.name.trim() : current.name
  const slug = isNonEmptyString(input.slug)
    ? slugify(input.slug)
    : current.slug
  if (!slug) {
    throw createError({ statusCode: 400, statusMessage: 'Slug is required' })
  }
  assertUniqueSlug(slug, routes, id)

  const updated: CustomRoute = {
    ...current,
    name,
    slug,
    modelIds: input.modelIds !== undefined
      ? normalizeModelIds(input.modelIds)
      : current.modelIds,
    updatedAt: new Date().toISOString(),
  }
  routes[index] = updated
  writeCustomRoutes(routes, event)
  return toPublicCustomRoute(updated, providerModelEnabledMap(event))
}

export function deleteCustomRoute(id: string, event?: H3Event) {
  const routes = readCustomRoutes(event)
  const next = routes.filter(route => route.id !== id)
  if (next.length === routes.length) {
    throw createError({ statusCode: 404, statusMessage: 'Route not found' })
  }
  writeCustomRoutes(next, event)
  return { ok: true as const }
}

/**
 * If `publicModelId` is `{routeSlug}/{provider}/{model}` for an attached model,
 * return the underlying `{provider}/{model}`. Otherwise return the input unchanged.
 */
export function unwrapCustomRouteModelId(
  publicModelId: string,
  event?: H3Event,
): string {
  const trimmed = publicModelId.trim()
  const slash = trimmed.indexOf('/')
  if (slash <= 0 || slash === trimmed.length - 1) {
    return trimmed
  }
  const routeSlug = trimmed.slice(0, slash)
  const rest = trimmed.slice(slash + 1)
  const route = findCustomRouteBySlug(routeSlug, event)
  if (!route || !route.modelIds.includes(rest)) {
    return trimmed
  }
  return rest
}

/** Virtual `/v1/models` rows for enabled attached models on every custom route. */
export function listCustomRouteOpenAiModels(event?: H3Event) {
  const enabledMap = providerModelEnabledMap(event)
  const data: Array<{
    id: string
    object: 'model'
    created: number
    owned_by: string
  }> = []
  const seen = new Set<string>()

  for (const route of readCustomRoutes(event)) {
    for (const modelId of route.modelIds) {
      if (enabledMap.get(modelId) !== true) {
        continue
      }
      const id = `${route.slug}/${modelId}`
      if (seen.has(id)) {
        continue
      }
      seen.add(id)
      data.push({
        id,
        object: 'model',
        created: 0,
        owned_by: route.slug,
      })
    }
  }

  return data
}
