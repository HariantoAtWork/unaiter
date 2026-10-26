export type ProviderPreset = {
  /** Display name, also used as the suggested provider name. */
  name: string
  /** OpenAI-compatible base URL, including API version path where needed. */
  baseUrl: string
  /** Server adapter to attach (e.g. opencode). Defaults to OpenAI-compatible. */
  adapterId?: string
  /** Where to create an API key. Omitted for local runtimes. */
  keyUrl?: string
  /** Local runtime needs no API key. */
  keyOptional?: boolean
  /**
   * The provider may use a non-default key format, e.g. `id|key` pairs.
   * Only affects the keys textarea placeholder.
   */
  keyPlaceholder?: string
  icon: string
  category: string
}

export const PROVIDER_PRESET_CATEGORIES = [
  'Hosted',
  'Free tier',
  'Local',
] as const

export const PROVIDER_PRESETS: ProviderPreset[] = [
  // ---------------------------------------------------------------- Hosted
  {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    icon: 'i-lucide-bot',
    category: 'Hosted',
  },
  {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    icon: 'i-lucide-shield',
    category: 'Hosted',
  },
  {
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyUrl: 'https://aistudio.google.com/apikey',
    icon: 'i-lucide-globe',
    category: 'Hosted',
  },
  {
    name: 'Azure OpenAI',
    baseUrl: 'https://YOUR-RESOURCE.openai.azure.com/openai/v1',
    keyUrl: 'https://portal.azure.com',
    icon: 'i-lucide-cloud-cog',
    category: 'Hosted',
  },
  {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    icon: 'i-lucide-sparkles',
    category: 'Hosted',
  },
  {
    name: 'xAI Grok',
    baseUrl: 'https://api.x.ai/v1',
    keyUrl: 'https://console.x.ai',
    icon: 'i-lucide-zap',
    category: 'Hosted',
  },
  {
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    keyUrl: 'https://console.mistral.ai/api-keys',
    icon: 'i-lucide-wind',
    category: 'Hosted',
  },
  {
    name: 'Cohere',
    baseUrl: 'https://api.cohere.com/v2',
    keyUrl: 'https://dashboard.cohere.com/api-keys',
    icon: 'i-lucide-hexagon',
    category: 'Hosted',
  },
  {
    name: 'Amazon Bedrock',
    baseUrl: 'https://bedrock-runtime.eu-central-1.amazonaws.com/v1',
    keyUrl: 'https://console.aws.amazon.com/bedrock',
    icon: 'i-lucide-square-stack',
    category: 'Hosted',
  },
  {
    name: 'Moonshot Kimi',
    baseUrl: 'https://api.moonshot.ai/v1',
    keyUrl: 'https://platform.moonshot.ai/console/api-keys',
    icon: 'i-lucide-moon',
    category: 'Hosted',
  },
  {
    name: 'Zhipu GLM',
    baseUrl: 'https://api.z.ai/v1',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    icon: 'i-lucide-brain',
    category: 'Hosted',
  },
  {
    name: 'MiniMax',
    baseUrl: 'https://api.minimax.io/v1',
    keyUrl: 'https://www.minimax.io/platform',
    icon: 'i-lucide-cpu',
    category: 'Hosted',
  },
  {
    name: 'Qwen / DashScope',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    keyUrl: 'https://modelstudio.console.alibabacloud.com',
    icon: 'i-lucide-cloud',
    category: 'Hosted',
  },
  {
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    keyUrl: 'https://api.together.xyz/settings/api-keys',
    icon: 'i-lucide-network',
    category: 'Hosted',
  },
  {
    name: 'Fireworks',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    keyUrl: 'https://app.fireworks.ai/settings/users/api-keys',
    icon: 'i-lucide-flame',
    category: 'Hosted',
  },
  {
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys',
    icon: 'i-lucide-gauge',
    category: 'Free tier',
  },
  {
    name: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    keyUrl: 'https://cloud.cerebras.ai',
    icon: 'i-lucide-zap',
    category: 'Free tier',
  },
  {
    name: 'SambaNova',
    baseUrl: 'https://api.sambanova.ai/v1',
    keyUrl: 'https://cloud.sambanova.ai/apis',
    icon: 'i-lucide-fast-forward',
    category: 'Free tier',
  },
  {
    name: 'GitHub Models',
    baseUrl: 'https://models.github.ai/inference/v1',
    keyUrl: 'https://github.com/settings/tokens',
    icon: 'i-lucide-git-branch',
    category: 'Free tier',
  },
  {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys',
    icon: 'i-lucide-route',
    category: 'Free tier',
  },
  {
    name: 'OpenCode',
    baseUrl: 'https://opencode.ai/inference/openai/v1',
    adapterId: 'opencode',
    keyUrl: 'https://opencode.ai/console/keys',
    keyOptional: true,
    keyPlaceholder: 'Leave empty for free models (uses public). Or paste an oc_sk_… key.',
    icon: 'i-lucide-box-select',
    category: 'Free tier',
  },
  // ----------------------------------------------------------------- Local
  {
    name: 'Ollama',
    baseUrl: 'http://host.docker.internal:11434/v1',
    keyOptional: true,
    icon: 'i-lucide-box',
    category: 'Local',
  },
  {
    name: 'LM Studio',
    baseUrl: 'http://host.docker.internal:1234/v1',
    keyOptional: true,
    icon: 'i-lucide-layers',
    category: 'Local',
  },
  {
    name: 'llama.cpp server',
    baseUrl: 'http://host.docker.internal:8080/v1',
    keyOptional: true,
    icon: 'i-lucide-terminal',
    category: 'Local',
  },
  {
    name: 'vLLM',
    baseUrl: 'http://host.docker.internal:8000/v1',
    keyOptional: true,
    icon: 'i-lucide-server',
    category: 'Local',
  },
  {
    name: 'LocalAI',
    baseUrl: 'http://host.docker.internal:8081/v1',
    keyOptional: true,
    icon: 'i-lucide-hard-drive',
    category: 'Local',
  },
  {
    name: 'Jan',
    baseUrl: 'http://host.docker.internal:1337/v1',
    keyOptional: true,
    icon: 'i-lucide-monitor',
    category: 'Local',
  },
]

export const CUSTOM_PROVIDER_PRESET: ProviderPreset = {
  name: 'Custom endpoint',
  baseUrl: '',
  keyOptional: true,
  icon: 'i-lucide-puzzle',
  category: 'Custom',
}

export type ProviderPresetMenuItem = ProviderPreset & {
  label: string
  description: string
  type?: 'label' | 'separator' | 'item'
}

/** Presets grouped under category labels, ready for `USelectMenu`. */
export function providerPresetMenuItems(): ProviderPresetMenuItem[] {
  const items: ProviderPresetMenuItem[] = []

  for (const category of PROVIDER_PRESET_CATEGORIES) {
    items.push({ label: category, description: '', icon: '', type: 'label' })

    for (const preset of PROVIDER_PRESETS.filter(entry => entry.category === category)) {
      items.push({
        ...preset,
        label: preset.name,
        description: preset.baseUrl,
      })
    }
  }

  items.push({ label: 'Custom', description: '', icon: '', type: 'label' })
  items.push({
    ...CUSTOM_PROVIDER_PRESET,
    label: CUSTOM_PROVIDER_PRESET.name,
    description: 'Fill in the base URL yourself',
  })

  return items
}

/** Match a preset from a saved base URL, ignoring scheme and trailing slash. */
export function findPresetForBaseUrl(baseUrl: string): ProviderPreset | null {
  const normalise = (value: string) => value.trim().toLowerCase().replace(/\/+$/, '')
  const target = normalise(baseUrl)
  if (!target) {
    return null
  }

  const exact = PROVIDER_PRESETS.find(preset => normalise(preset.baseUrl) === target)
  if (exact) {
    return exact
  }

  // Local runtimes are often on a different host or port.
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal|0\.0\.0\.0)/i
    .test(target)
  if (isLocal) {
    return PROVIDER_PRESETS.find(preset => preset.category === 'Local') || null
  }

  return null
}
