import type { IntentRouterPublic } from '#router-shared/types'

/** Prefer `await useFetch('/api/auto/config')` on pages that need SSR-ready form state. */
export function useRouterConfig() {
  return useFetch<IntentRouterPublic>('/api/auto/config')
}
