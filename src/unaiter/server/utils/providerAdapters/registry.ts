import { basetenAdapter } from './baseten'
import { defaultAdapter, DEFAULT_ADAPTER_ID } from './default'
import { opencodeAdapter } from './opencode'
import type {
  AdapterPublic,
  ProviderAdapter,
  ResolveAdapterInput,
} from './types'

const adapters = new Map<string, ProviderAdapter>()

export function registerAdapter(adapter: ProviderAdapter) {
  adapters.set(adapter.id, adapter)
}

// Register here so Nitro auto-imports from this file still see a filled catalogue
// (duplicated barrel exports from index.ts are ignored in favour of this module).
registerAdapter(defaultAdapter)
registerAdapter(opencodeAdapter)
registerAdapter(basetenAdapter)

export function getAdapter(id: string): ProviderAdapter | undefined {
  return adapters.get(id)
}

export function isKnownAdapterId(id: string): boolean {
  return adapters.has(id)
}

export function listAdapters(): ProviderAdapter[] {
  return [...adapters.values()]
}

export function listAdaptersPublic(): AdapterPublic[] {
  return listAdapters().map(adapter => ({
    id: adapter.id,
    label: adapter.label,
  }))
}

/**
 * Resolve by explicit adapterId only. Specialists are opt-in via the provider
 * form / preset `adapterId` — base URL never auto-selects an adapter.
 */
export function resolveAdapter(input: ResolveAdapterInput = {}): ProviderAdapter {
  const id = typeof input.adapterId === 'string' ? input.adapterId.trim() : ''
  if (id) {
    const byId = adapters.get(id)
    if (byId) {
      return byId
    }
  }

  return adapters.get(DEFAULT_ADAPTER_ID) || defaultAdapter
}

/** Normalise a stored adapterId (unknown / empty → default). No URL auto-attach. */
export function normalizeAdapterId(
  adapterId: unknown,
  _baseUrl?: string,
): string {
  if (typeof adapterId === 'string' && adapterId.trim()) {
    const id = adapterId.trim()
    if (adapters.has(id)) {
      return id
    }
  }
  return DEFAULT_ADAPTER_ID
}
