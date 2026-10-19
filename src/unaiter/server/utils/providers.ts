import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { H3Event } from 'h3'
import { ensureDataRoot } from './dataRoot'
import { newId } from './id'
import {
  isKnownAdapterId,
  normalizeAdapterId,
} from './providerAdapters'
import {
  DEFAULT_PROVIDER_KEY_METHOD,
  isProviderKeyMethod,
  normalizeProviderKeyMethod,
  type ProviderKeyMethod,
} from './providerKeyMethods'
import { normalizeModelTasks, type ModelTask } from './modelTasks'
import { slugify } from './slug'

export type ProviderKey = {
  id: string
  key: string
  valid: boolean | null
  createdAt: string
}

export type ProviderModel = {
  id: string
  /** Provider model id (unique per provider), e.g. gpt-4o */
  modelId: string
  /** Context window in tokens when the provider advertises one. */
  contextLength?: number | null
  /** Raw provider `/models` entry, kept verbatim (not exposed on the API). */
  providerMeta?: Record<string, unknown>
  /** Verified API hats from the last per-format test (empty until tested). */
  tasks: ModelTask[]
  enabled: boolean
  source: 'manual' | 'fetched'
  lastTestOk: boolean | null
  testedAt: string | null
  createdAt: string
}

export type Provider = {
  id: string
  name: string
  slug: string
  baseUrl: string
  type: 'openai-compatible'
  /** Server adapter id (e.g. default, opencode). */
  adapterId: string
  /** How the key list rotates when a key is exhausted. */
  keyMethod: ProviderKeyMethod
  keys: ProviderKey[]
  /** Catalogue: enabled entries appear on GET /v1/models. */
  models: ProviderModel[]
  createdAt: string
  updatedAt: string
}

export type ProviderPublic = Omit<Provider, 'keys' | 'models'> & {
  keyCount: number
  validKeyCount: number
  modelCount: number
  enabledModelCount: number
  keys: Array<{
    id: string
    hint: string
    valid: boolean | null
    createdAt: string
  }>
}

export type ParsedBulkKey = {
  id: string
  key: string
}

/** Serializable provider payload used for export/import round-trips. */
export type ProviderExport = Provider

export type ExportedProviders = {
  version: number
  exportedAt: string
  providers: ProviderExport[]
}

const EXPORT_VERSION = 1

export type ImportProvidersInput = {
  providers?: unknown
  overwrite?: boolean
}

export type ImportProvidersResult = {
  imported: number
  overwritten: number
  skipped: number
}

const STORE_FILENAME = 'providers.json'

function storePath(event?: H3Event) {
  return join(ensureDataRoot(event), STORE_FILENAME)
}

function normalizeProvider(raw: Provider): Provider {
  const models = Array.isArray(raw.models) ? raw.models : []
  return {
    ...raw,
    adapterId: normalizeAdapterId(raw.adapterId, raw.baseUrl),
    keyMethod: normalizeProviderKeyMethod(raw.keyMethod),
    keys: Array.isArray(raw.keys) ? raw.keys : [],
    models: models.map(model => ({
      ...model,
      tasks: normalizeModelTasks(model.tasks),
    })),
  }
}

function assertAdapterId(adapterId: string) {
  if (!isKnownAdapterId(adapterId)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Unknown adapter "${adapterId}"`,
    })
  }
}

/** Explicit id must be registered; empty/missing falls back to URL hint then default. */
function resolveInputAdapterId(adapterId: unknown, baseUrl: string): string {
  if (typeof adapterId === 'string' && adapterId.trim()) {
    const id = adapterId.trim()
    assertAdapterId(id)
    return id
  }
  return normalizeAdapterId(undefined, baseUrl)
}

export function readStore(event?: H3Event): Provider[] {
  const path = storePath(event)
  if (!existsSync(path)) {
    return []
  }

  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as Provider[]
    return Array.isArray(parsed) ? parsed.map(normalizeProvider) : []
  }
  catch {
    return []
  }
}

export function writeStore(providers: Provider[], event?: H3Event) {
  writeFileSync(storePath(event), `${JSON.stringify(providers, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
}

function keyHint(key: string) {
  if (key.length <= 8) {
    return '••••'
  }
  return `••••${key.slice(-4)}`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function toPublicProvider(provider: Provider): ProviderPublic {
  const normalized = normalizeProvider(provider)
  return {
    id: normalized.id,
    name: normalized.name,
    slug: normalized.slug,
    baseUrl: normalized.baseUrl,
    type: normalized.type,
    adapterId: normalized.adapterId,
    keyMethod: normalized.keyMethod,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    keyCount: normalized.keys.length,
    validKeyCount: normalized.keys.filter(item => item.valid === true).length,
    modelCount: normalized.models.length,
    enabledModelCount: normalized.models.filter(item => item.enabled).length,
    keys: normalized.keys.map(item => ({
      id: item.id,
      hint: keyHint(item.key),
      valid: item.valid,
      createdAt: item.createdAt,
    })),
  }
}

export function findProviderOrThrow(providers: Provider[], id: string) {
  const provider = providers.find(item => item.id === id)
  if (!provider) {
    throw createError({ statusCode: 404, statusMessage: 'Provider not found' })
  }
  return provider
}

export function listProviders(event?: H3Event) {
  return readStore(event).map(toPublicProvider)
}

export function getProvider(id: string, event?: H3Event) {
  const provider = findProviderOrThrow(readStore(event), id)
  return toPublicProvider(provider)
}

export function getOverview(event?: H3Event) {
  const providers = readStore(event)
  const keys = providers.flatMap(provider => provider.keys)

  return {
    providerCount: providers.length,
    keyCount: keys.length,
    validKeyCount: keys.filter(key => key.valid === true).length,
    uncheckedKeyCount: keys.filter(key => key.valid === null).length,
    providers: providers.map(toPublicProvider),
  }
}

function uniqueSlug(
  name: string,
  providers: Provider[],
  preferred?: string,
  excludeId?: string,
) {
  const base = slugify(preferred || name) || 'provider'
  let slug = base
  let index = 2

  while (providers.some(provider => provider.slug === slug && provider.id !== excludeId)) {
    slug = `${base}-${index}`
    index += 1
  }

  return slug
}

function existingKeySet(providers: Provider[], excludeProviderId?: string) {
  return new Set(
    providers
      .filter(provider => provider.id !== excludeProviderId)
      .flatMap(provider => provider.keys.map(item => item.key)),
  )
}

function assertBaseUrl(baseUrl: string) {
  if (!baseUrl) {
    throw createError({ statusCode: 400, statusMessage: 'Base URL is required' })
  }
  if (!URL.canParse(baseUrl)) {
    throw createError({ statusCode: 400, statusMessage: 'Base URL is invalid' })
  }
}

/**
 * Parse bulk key lines:
 * - `sk-...` → generate uuid v7 id
 * - `my-id|sk-...` → use given id
 * Duplicate API keys (within the paste or already stored) are skipped.
 */
export function parseBulkKeys(
  raw: string,
  knownKeys: Set<string> = new Set(),
): { entries: ParsedBulkKey[], skippedExisting: number } {
  const seenKeys = new Set<string>(knownKeys)
  const entries: ParsedBulkKey[] = []
  let skippedExisting = 0

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }

    const separator = trimmed.indexOf('|')
    let id: string
    let key: string

    if (separator === -1) {
      id = newId()
      key = trimmed
    }
    else {
      id = trimmed.slice(0, separator).trim() || newId()
      key = trimmed.slice(separator + 1).trim()
    }

    if (!key) {
      continue
    }

    if (seenKeys.has(key)) {
      skippedExisting += 1
      continue
    }

    seenKeys.add(key)
    entries.push({ id, key })
  }

  return { entries, skippedExisting }
}

async function materialiseKeys(
  entries: ParsedBulkKey[],
  baseUrl: string,
  validateKeys: boolean,
  now: string,
  adapterId?: string,
) {
  const keys: ProviderKey[] = []
  let skippedInvalid = 0

  for (const entry of entries) {
    let valid: boolean | null = null
    if (validateKeys) {
      valid = await validateOpenAiCompatibleKey(baseUrl, entry.key, { adapterId })
      if (!valid) {
        skippedInvalid += 1
        continue
      }
    }

    keys.push({
      id: entry.id,
      key: entry.key,
      valid,
      createdAt: now,
    })
  }

  return { keys, skippedInvalid }
}

export type CreateProviderInput = {
  name: string
  slug?: string
  baseUrl: string
  adapterId?: string
  keysRaw: string
  validateKeys?: boolean
}

export async function createProvider(
  input: CreateProviderInput,
  event?: H3Event,
) {
  const name = input.name.trim()
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
  const validateKeys = Boolean(input.validateKeys)
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'Name is required' })
  }
  assertBaseUrl(baseUrl)
  const adapterId = resolveInputAdapterId(input.adapterId, baseUrl)

  const providers = readStore(event)
  const keysRaw = input.keysRaw?.trim() || ''
  const { entries, skippedExisting } = parseBulkKeys(
    keysRaw,
    existingKeySet(providers),
  )

  // Keys are optional (local OpenAI-compatible servers often need none).
  // Only reject when the user pasted keys that could not be accepted.
  if (keysRaw && entries.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: skippedExisting
        ? 'All API keys already exist or were empty'
        : 'No valid API keys found',
    })
  }

  const now = new Date().toISOString()
  const { keys, skippedInvalid } = entries.length
    ? await materialiseKeys(entries, baseUrl, validateKeys, now, adapterId)
    : { keys: [] as ProviderKey[], skippedInvalid: 0 }

  if (keysRaw && keys.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No valid API keys found',
    })
  }

  const provider: Provider = {
    id: newId(),
    name,
    slug: uniqueSlug(name, providers, input.slug),
    baseUrl,
    type: 'openai-compatible',
    adapterId,
    keyMethod: DEFAULT_PROVIDER_KEY_METHOD,
    keys,
    models: [],
    createdAt: now,
    updatedAt: now,
  }

  providers.push(provider)
  writeStore(providers, event)

  return {
    provider: toPublicProvider(provider),
    acceptedKeyCount: keys.length,
    skippedExisting,
    skippedInvalid,
  }
}

export type UpdateProviderInput = {
  name: string
  slug?: string
  baseUrl: string
  adapterId?: string
  keyMethod?: ProviderKeyMethod
  keysRaw?: string
  validateKeys?: boolean
}

export async function updateProvider(
  id: string,
  input: UpdateProviderInput,
  event?: H3Event,
) {
  const name = input.name.trim()
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
  const validateKeys = Boolean(input.validateKeys)

  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'Name is required' })
  }
  assertBaseUrl(baseUrl)

  if (input.keyMethod !== undefined && !isProviderKeyMethod(input.keyMethod)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unknown key list method',
    })
  }

  const providers = readStore(event)
  const provider = findProviderOrThrow(providers, id)
  const now = new Date().toISOString()

  // When adapterId omitted on update, keep the existing one (still migrate/normalise).
  const nextAdapterId = input.adapterId !== undefined
    ? resolveInputAdapterId(input.adapterId, baseUrl)
    : normalizeAdapterId(provider.adapterId, baseUrl)

  provider.name = name
  provider.slug = uniqueSlug(name, providers, input.slug, id)
  provider.baseUrl = baseUrl
  provider.adapterId = nextAdapterId
  if (input.keyMethod !== undefined) {
    provider.keyMethod = input.keyMethod
  }
  provider.updatedAt = now

  let acceptedKeyCount = 0
  let skippedExisting = 0
  let skippedInvalid = 0

  const keysRaw = input.keysRaw?.trim() || ''
  if (keysRaw) {
    const known = new Set([
      ...existingKeySet(providers, id),
      ...provider.keys.map(item => item.key),
    ])
    const parsed = parseBulkKeys(keysRaw, known)
    skippedExisting = parsed.skippedExisting

    const materialised = await materialiseKeys(
      parsed.entries,
      baseUrl,
      validateKeys,
      now,
      nextAdapterId,
    )
    skippedInvalid = materialised.skippedInvalid
    acceptedKeyCount = materialised.keys.length
    provider.keys.push(...materialised.keys)
  }

  writeStore(providers, event)

  return {
    provider: toPublicProvider(provider),
    acceptedKeyCount,
    skippedExisting,
    skippedInvalid,
  }
}

export function deleteProvider(id: string, event?: H3Event) {
  const providers = readStore(event)
  const index = providers.findIndex(item => item.id === id)
  if (index === -1) {
    throw createError({ statusCode: 404, statusMessage: 'Provider not found' })
  }

  const [removed] = providers.splice(index, 1)
  writeStore(providers, event)
  return { ok: true as const, id: removed.id }
}

/**
 * Serialise all providers (including secrets) for export.
 */
export function exportProviders(event?: H3Event): ExportedProviders {
  const providers = readStore(event).map(provider => {
    const normalized = normalizeProvider(provider)
    return {
      id: normalized.id,
      name: normalized.name,
      slug: normalized.slug,
      baseUrl: normalized.baseUrl,
      type: normalized.type,
      adapterId: normalized.adapterId,
      keyMethod: normalized.keyMethod,
      keys: normalized.keys.map(key => ({ ...key })),
      models: normalized.models.map(model => ({ ...model })),
      createdAt: normalized.createdAt,
      updatedAt: normalized.updatedAt,
    }
  })

  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    providers,
  }
}

/**
 * Shape-check and normalise arbitrary import JSON into full provider records.
 * Accepts either an `ExportedProviders` envelope or a bare provider array.
 */
export function parseImportPayload(raw: unknown): Provider[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as ExportedProviders)?.providers)
      ? (raw as ExportedProviders).providers
      : null

  if (!list) {
    throw createError({ statusCode: 400, statusMessage: 'Unrecognised providers file' })
  }

  const now = new Date().toISOString()
  const providers: Provider[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') {
      continue
    }
    const provider = entry as Partial<Provider>
    const name = typeof provider.name === 'string' ? provider.name.trim() : ''
    const baseUrl = typeof provider.baseUrl === 'string' ? provider.baseUrl.trim() : ''
    if (!name || !baseUrl || !URL.canParse(baseUrl)) {
      continue
    }
    providers.push(cloneImportedProvider({ ...provider, name, baseUrl }, now))
  }

  if (!providers.length) {
    throw createError({ statusCode: 400, statusMessage: 'No importable providers found' })
  }

  return providers
}

function cloneImportedProvider(source: Partial<Provider>, now: string): Provider {
  const keys = Array.isArray(source.keys) ? source.keys : []
  const models = Array.isArray(source.models) ? source.models : []
  const id = typeof source.id === 'string' && source.id ? source.id : newId()

  const baseUrl = String(source.baseUrl ?? '').trim().replace(/\/+$/, '')
  return {
    id,
    name: String(source.name ?? '').trim(),
    slug: String(source.slug ?? '').trim() || slugify(String(source.name ?? '')),
    baseUrl,
    type: 'openai-compatible',
    adapterId: normalizeAdapterId(source.adapterId, baseUrl),
    keyMethod: normalizeProviderKeyMethod(source.keyMethod),
    keys: keys.map(key => ({
      id: typeof key?.id === 'string' && key.id ? key.id : newId(),
      key: String(key?.key ?? ''),
      valid: typeof key?.valid === 'boolean' ? key.valid : null,
      createdAt: typeof key?.createdAt === 'string' ? key.createdAt : now,
    })),
    models: models.map(model => ({
      id: typeof model?.id === 'string' && model.id ? model.id : newId(),
      modelId: String(model?.modelId ?? ''),
      contextLength: typeof model?.contextLength === 'number' && model.contextLength > 0
        ? model.contextLength
        : null,
      providerMeta: isPlainObject(model?.providerMeta) ? model.providerMeta : undefined,
      tasks: normalizeModelTasks(model?.tasks),
      enabled: model?.enabled !== false,
      source: model?.source === 'manual' ? 'manual' as const : 'fetched' as const,
      lastTestOk: typeof model?.lastTestOk === 'boolean' ? model.lastTestOk : null,
      testedAt: typeof model?.testedAt === 'string' ? model.testedAt : null,
      createdAt: typeof model?.createdAt === 'string' ? model.createdAt : now,
    })),
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : now,
    updatedAt: now,
  }
}

/**
 * Import selected providers from a previously exported file.
 *
 * Providers are matched to existing ones by `slug` then `name`.
 * - overwrite = true  → replace matched providers entirely.
 * - overwrite = false → skip matches, only add new ones.
 */
export async function importProviders(
  input: ImportProvidersInput,
  event?: H3Event,
): Promise<ImportProvidersResult> {
  const overwrite = Boolean(input.overwrite)
  const incoming = Array.isArray(input.providers) ? input.providers : []

  if (!incoming.length) {
    throw createError({ statusCode: 400, statusMessage: 'No providers selected' })
  }

  const now = new Date().toISOString()
  const providers = readStore(event)
  let imported = 0
  let overwritten = 0
  let skipped = 0

  for (const entry of incoming) {
    if (!entry || typeof entry !== 'object') {
      continue
    }
    const source = entry as Partial<Provider>
    const name = typeof source.name === 'string' ? source.name.trim() : ''
    const baseUrl = typeof source.baseUrl === 'string' ? source.baseUrl.trim() : ''
    if (!name || !baseUrl || !URL.canParse(baseUrl)) {
      continue
    }

    const incomingSlug = typeof source.slug === 'string' && source.slug.trim()
      ? source.slug.trim()
      : slugify(name)

    const matchIndex = providers.findIndex(provider =>
      (incomingSlug && provider.slug === incomingSlug) || provider.name === name)

    if (matchIndex !== -1) {
      if (overwrite) {
        const replacement = cloneImportedProvider(
          { ...source, name, baseUrl },
          now,
        )
        replacement.id = providers[matchIndex]!.id
        replacement.slug = uniqueSlug(name, providers, incomingSlug, replacement.id)
        providers[matchIndex] = replacement
        overwritten += 1
      }
      else {
        skipped += 1
      }
      continue
    }

    const created = cloneImportedProvider({ ...source, name, baseUrl }, now)
    created.id = newId()
    created.slug = uniqueSlug(name, providers, incomingSlug)
    providers.push(created)
    imported += 1
  }

  writeStore(providers, event)

  return { imported, overwritten, skipped }
}

