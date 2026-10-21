import type { CustomRoutePublic } from '#router-shared/types'

export function useCustomRoutes() {
  return useFetch<{ routes: CustomRoutePublic[] }>('/api/router')
}
