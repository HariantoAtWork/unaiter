// Adapters register in registry.ts (Nitro may auto-import that file instead of this barrel).

export {
  BASETEN_ADAPTER_ID,
  basetenAdapter,
} from './baseten'
export { DEFAULT_ADAPTER_ID, defaultAdapter } from './default'
export {
  OPENCODE_ADAPTER_ID,
  matchOpenCodeBaseUrl,
  opencodeAdapter,
} from './opencode'
export {
  getAdapter,
  isKnownAdapterId,
  listAdapters,
  listAdaptersPublic,
  normalizeAdapterId,
  registerAdapter,
  resolveAdapter,
} from './registry'
export { aggregateOpenAiChatStream } from './streamAggregate'
export type {
  AdapterPublic,
  FinalizeChatResponseResult,
  PrepareChatBodyResult,
  ProviderAdapter,
  ResolveAdapterInput,
} from './types'
