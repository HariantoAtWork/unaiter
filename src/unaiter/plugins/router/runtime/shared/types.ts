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
