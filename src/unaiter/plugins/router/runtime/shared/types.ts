export type IntentRouteKind = 'writing' | 'code'

export type IntentPlanStep = {
  route: IntentRouteKind
  /** Short task description for that specialist only. */
  brief: string
}

export type IntentRouterConfig = {
  /** When false, `publicModelId` is omitted from /v1/models and completions reject it. */
  enabled: boolean
  /** Client-facing model id, e.g. `router/auto`. */
  publicModelId: string
  /** Enabled catalogue id used to plan writing/code steps. */
  classifierModelId: string
  /** Specialist model ids keyed by intent. */
  routes: Record<IntentRouteKind, string>
}

export type IntentRouterPublic = IntentRouterConfig & {
  updatedAt: string | null
}

/** Named prefix that re-exports selected provider models. */
export type CustomRoute = {
  id: string
  name: string
  /** Path prefix, e.g. `cursor` → public id `cursor/{provider}/{model}`. */
  slug: string
  /** Attached public provider model ids (`{providerSlug}/{modelId}`). */
  modelIds: string[]
  createdAt: string
  updatedAt: string
}

export type CustomRoutePublic = CustomRoute & {
  /** Attached model ids (including ones deleted from providers). */
  modelCount: number
  /** Attached ids that still exist on a provider and are enabled. */
  enabledModelCount: number
}

export type CatalogueModel = {
  id: string
  enabled: boolean
  providerName: string
  providerSlug: string
}

export type ModelStatusFilter = 'all' | 'enabled' | 'disabled'
