/** Unaiter model hats: API task type → upstream OpenAI-compatible path. */

export const MODEL_TASKS = [
  'generate',
  'embedding',
  'score',
  'moderation',
  'decision',
] as const

export type ModelTask = (typeof MODEL_TASKS)[number]

export type ModelTaskSpec = {
  task: ModelTask
  /** Path under the provider base URL (no leading slash). */
  path: string
}

export const MODEL_TASK_SPECS: readonly ModelTaskSpec[] = [
  { task: 'generate', path: 'chat/completions' },
  { task: 'embedding', path: 'embeddings' },
  { task: 'score', path: 'rerank' },
  { task: 'moderation', path: 'moderations' },
  { task: 'decision', path: 'systemone' },
] as const

const TASK_SET = new Set<string>(MODEL_TASKS)

/** Accept common aliases from `/models` or an earlier `chat` label. */
const ADVERTISED_ALIASES: Record<string, ModelTask> = {
  generate: 'generate',
  chat: 'generate',
  embedding: 'embedding',
  score: 'score',
  moderation: 'moderation',
  decision: 'decision',
}

export function isModelTask(value: unknown): value is ModelTask {
  return typeof value === 'string' && TASK_SET.has(value)
}

/** Normalise a provider-advertised `task` field; unknown / empty → null. */
export function parseAdvertisedTask(value: unknown): ModelTask | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalised = value.trim().toLowerCase()
  return ADVERTISED_ALIASES[normalised] ?? null
}

/**
 * Probe order: advertised task first when known; otherwise `generate` (chat
 * completions) when meta has no task. Remaining formats follow so multi-hat
 * models are found.
 *
 * `decision` /systemone is only probed when advertised as decision — some
 * gateways accept that path for any model id and would false-positive.
 */
export function probeOrderForAdvertisedTask(advertised: ModelTask | null): ModelTask[] {
  const first: ModelTask = advertised ?? 'generate'
  const rest = MODEL_TASKS.filter((task) => {
    if (task === first) {
      return false
    }
    if (task === 'decision' && advertised !== 'decision') {
      return false
    }
    return true
  })
  return [first, ...rest]
}

export function normalizeModelTasks(value: unknown): ModelTask[] {
  if (!Array.isArray(value)) {
    return []
  }
  const seen = new Set<ModelTask>()
  const tasks: ModelTask[] = []
  for (const item of value) {
    // Migrate brief `chat` labels → `generate`.
    const mapped = item === 'chat'
      ? 'generate' as const
      : isModelTask(item)
        ? item
        : parseAdvertisedTask(item)
    if (mapped && !seen.has(mapped)) {
      seen.add(mapped)
      tasks.push(mapped)
    }
  }
  return tasks
}

export function minimalProbeBody(task: ModelTask, modelId: string): Record<string, unknown> {
  switch (task) {
    case 'generate':
      return {
        model: modelId,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }
    case 'embedding':
      return { model: modelId, input: 'ping' }
    case 'score':
      return { model: modelId, query: 'ping', documents: ['a'] }
    case 'moderation':
      return { model: modelId, input: 'ping' }
    case 'decision':
      // Halogen System One: questions.*.type ∈ noul|choice|score; state required.
      return {
        model: modelId,
        state: {},
        questions: {
          probe: { type: 'noul', instructions: 'ping' },
        },
      }
  }
}
