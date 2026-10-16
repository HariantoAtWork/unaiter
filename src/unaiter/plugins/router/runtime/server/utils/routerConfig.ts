import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { H3Event } from 'h3'
import { ensureDataRoot } from '../../../../../server/utils/dataRoot'
import { DEFAULT_INTENT_ROUTER_CONFIG } from '../../shared/defaults'
import type { IntentRouteKind, IntentRouterConfig, IntentRouterPublic } from '../../shared/types'

const STORE_FILENAME = 'router.json'

const ROUTE_KINDS: IntentRouteKind[] = ['writing', 'code']

function storePath(event?: H3Event) {
  return join(ensureDataRoot(event), STORE_FILENAME)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function normalizeIntentRouterConfig(raw: unknown): IntentRouterConfig {
  const base = DEFAULT_INTENT_ROUTER_CONFIG
  if (!raw || typeof raw !== 'object') {
    return { ...base, routes: { ...base.routes } }
  }

  const input = raw as Record<string, unknown>
  const routesRaw = (input.routes && typeof input.routes === 'object')
    ? input.routes as Record<string, unknown>
    : {}

  const routes = { ...base.routes }
  for (const kind of ROUTE_KINDS) {
    if (isNonEmptyString(routesRaw[kind])) {
      routes[kind] = routesRaw[kind].trim()
    }
  }

  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : base.enabled,
    publicModelId: isNonEmptyString(input.publicModelId)
      ? input.publicModelId.trim()
      : base.publicModelId,
    classifierModelId: isNonEmptyString(input.classifierModelId)
      ? input.classifierModelId.trim()
      : base.classifierModelId,
    routes,
  }
}

export function readIntentRouterConfig(event?: H3Event): IntentRouterConfig {
  const path = storePath(event)
  if (!existsSync(path)) {
    return normalizeIntentRouterConfig(null)
  }
  try {
    return normalizeIntentRouterConfig(JSON.parse(readFileSync(path, 'utf8')))
  }
  catch {
    return normalizeIntentRouterConfig(null)
  }
}

export function writeIntentRouterConfig(
  config: IntentRouterConfig,
  event?: H3Event,
): IntentRouterPublic {
  const normalized = normalizeIntentRouterConfig(config)
  const updatedAt = new Date().toISOString()
  const path = storePath(event)
  writeFileSync(
    path,
    `${JSON.stringify({ ...normalized, updatedAt }, null, 2)}\n`,
    { mode: 0o600 },
  )
  return { ...normalized, updatedAt }
}

export function getIntentRouterPublic(event?: H3Event): IntentRouterPublic {
  const path = storePath(event)
  const config = readIntentRouterConfig(event)
  let updatedAt: string | null = null
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { updatedAt?: unknown }
      if (isNonEmptyString(raw.updatedAt)) {
        updatedAt = raw.updatedAt
      }
    }
    catch {
      updatedAt = null
    }
  }
  return { ...config, updatedAt }
}

export function isIntentRouterPublicModel(
  modelId: string,
  event?: H3Event,
): boolean {
  const config = readIntentRouterConfig(event)
  return config.enabled && modelId.trim() === config.publicModelId
}
