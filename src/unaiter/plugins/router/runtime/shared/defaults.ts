import type { IntentRouterConfig } from './types'

export const DEFAULT_INTENT_ROUTER_CONFIG: IntentRouterConfig = {
  enabled: true,
  publicModelId: 'router/auto',
  classifierModelId: '1-min-ai/gpt-4.1-nano',
  routes: {
    writing: 'ollama-cloud/gemma4:31b',
    code: 'flash-next/Qwen3.8 Flash Next',
  },
}
