import type { IntentRouterPublic } from '#router-shared/types'

export function useRouterConfig() {
  return useFetch<IntentRouterPublic>('/api/router/config')
}
