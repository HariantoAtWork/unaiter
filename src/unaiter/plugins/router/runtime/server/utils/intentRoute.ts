import type { H3Event } from 'h3'
import {
  pickProviderKey,
  resolveRoutedModel,
} from '../../../../../server/utils/routeModel'
import type { IntentPlanStep, IntentRouteKind } from '../../shared/types'
import {
  isIntentRouterPublicModel,
  readIntentRouterConfig,
} from './routerConfig'

const MAX_PLAN_STEPS = 4

type ChatMessage = {
  role?: unknown
  content?: unknown
}

function messageText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part
        }
        if (part && typeof part === 'object' && 'text' in part) {
          const text = (part as { text?: unknown }).text
          return typeof text === 'string' ? text : ''
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

/** Flatten user-facing text from an OpenAI-style messages array. */
export function extractUserPrompt(messages: unknown): string {
  if (!Array.isArray(messages)) {
    return ''
  }
  const parts: string[] = []
  for (const item of messages as ChatMessage[]) {
    const role = typeof item?.role === 'string' ? item.role : ''
    if (role !== 'user' && role !== 'system') {
      continue
    }
    const text = messageText(item.content).trim()
    if (text) {
      parts.push(text)
    }
  }
  return parts.join('\n\n').trim()
}

function asRouteKind(value: unknown): IntentRouteKind | null {
  return value === 'writing' || value === 'code' ? value : null
}

function parsePlan(raw: string): IntentPlanStep[] | null {
  const trimmed = raw.trim()
  try {
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return null
    }
    const parsed = JSON.parse(jsonMatch[0]) as {
      route?: unknown
      steps?: unknown
    }

    if (Array.isArray(parsed.steps)) {
      const steps: IntentPlanStep[] = []
      for (const item of parsed.steps) {
        if (!item || typeof item !== 'object') {
          continue
        }
        const row = item as { route?: unknown, brief?: unknown }
        const route = asRouteKind(row.route)
        const brief = typeof row.brief === 'string' ? row.brief.trim() : ''
        if (route && brief) {
          steps.push({ route, brief })
        }
      }
      return steps.length ? steps.slice(0, MAX_PLAN_STEPS) : null
    }

    const route = asRouteKind(parsed.route)
    if (route) {
      return [{ route, brief: 'Answer the user request for this route only.' }]
    }
  }
  catch {
    return null
  }
  return null
}

async function upstreamChatCompletion(
  event: H3Event,
  publicModelId: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ content: string, raw: Record<string, unknown> }> {
  const routed = resolveRoutedModel(publicModelId, event)
  const key = routed.provider.keys.length === 0
    ? null
    : pickProviderKey(routed.provider)

  const upstreamUrl = `${routed.provider.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  if (key?.key) {
    headers.Authorization = `Bearer ${key.key}`
  }

  const response = await fetch(upstreamUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...payload,
      model: routed.upstreamModelId,
      stream: false,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) {
    throw createError({
      statusCode: 502,
      statusMessage: `Upstream "${publicModelId}" returned ${response.status}`,
    })
  }

  const raw = await response.json() as Record<string, unknown>
  const choices = raw.choices as Array<{ message?: { content?: unknown } }> | undefined
  const content = messageText(choices?.[0]?.message?.content)
  return { content, raw }
}

async function planIntentSteps(
  event: H3Event,
  prompt: string,
  classifierModelId: string,
): Promise<IntentPlanStep[]> {
  const { content } = await upstreamChatCompletion(
    event,
    classifierModelId,
    {
      temperature: 0,
      max_tokens: 400,
      messages: [
        {
          role: 'system',
          content:
            'Split the user message into ordered tasks. '
            + 'Each task is either writing or code. '
            + 'writing = poems, stories, essays, translation, creative language. '
            + 'code = programming, logs, refactoring, debugging, APIs. '
            + 'If the user asks for several distinct tasks (e.g. a poem AND code), return multiple steps in order. '
            + 'If there is only one task, return one step. '
            + 'Reply with JSON only: '
            + '{"steps":[{"route":"writing"|"code","brief":"short task for that specialist"}]}. '
            + 'brief must be specific and in the user\'s language. Max 4 steps.',
        },
        { role: 'user', content: prompt.slice(0, 8000) },
      ],
    },
    60_000,
  )

  return parsePlan(content) ?? [{
    route: 'code',
    brief: 'Answer the user request.',
  }]
}

function sectionHeading(route: IntentRouteKind, index: number, total: number): string {
  if (total === 1) {
    return ''
  }
  const label = route === 'writing' ? 'Writing' : 'Code'
  return `### ${index + 1}. ${label}\n\n`
}

function buildMergedCompletion(
  publicModelId: string,
  sections: string[],
): Record<string, unknown> {
  const content = sections.join('\n\n').trim()
  return {
    id: `chatcmpl-router-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: publicModelId,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  }
}

export type IntentRouterPrepareResult
  = | { kind: 'passthrough', body: Record<string, unknown> }
    | { kind: 'complete', response: Record<string, unknown> }

/**
 * Handle `router/auto` (or configured public id):
 * - 1 step → rewrite `model` and let the normal proxy stream
 * - 2+ steps → run specialists (non-stream), merge into one completion JSON
 */
export async function prepareIntentRouterRequest(
  event: H3Event,
  body: Record<string, unknown>,
): Promise<IntentRouterPrepareResult> {
  const publicModelId = typeof body.model === 'string' ? body.model : ''
  if (!isIntentRouterPublicModel(publicModelId, event)) {
    return { kind: 'passthrough', body }
  }

  const config = readIntentRouterConfig(event)
  const prompt = extractUserPrompt(body.messages)
  if (!prompt) {
    throw createError({
      statusCode: 400,
      statusMessage: 'messages with user content are required for router/auto',
    })
  }

  let steps: IntentPlanStep[]
  try {
    steps = await planIntentSteps(event, prompt, config.classifierModelId)
  }
  catch (err) {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      throw err
    }
    steps = [{ route: 'code', brief: 'Answer the user request.' }]
  }

  if (!steps.length) {
    steps = [{ route: 'code', brief: 'Answer the user request.' }]
  }

  // Single specialist: keep streaming via normal proxy path.
  if (steps.length === 1) {
    const step = steps[0]!
    const specialist = config.routes[step.route]?.trim()
    if (!specialist) {
      throw createError({
        statusCode: 500,
        statusMessage: `No specialist configured for route "${step.route}"`,
      })
    }
    resolveRoutedModel(specialist, event)
    setHeader(event, 'x-unaiter-route', step.route)
    setHeader(event, 'x-unaiter-routed-model', specialist)
    setHeader(event, 'x-unaiter-orchestrated', 'false')
    return {
      kind: 'passthrough',
      body: { ...body, model: specialist },
    }
  }

  // Multi-step orchestration (non-streaming JSON response).
  if (body.stream === true) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'Multi-step router orchestration does not support stream:true; omit stream or set stream:false',
    })
  }

  const routes: IntentRouteKind[] = []
  const models: string[] = []
  const sections: string[] = []

  // Independent steps can run in parallel.
  const settled = await Promise.all(steps.map(async (step, index) => {
    const specialist = config.routes[step.route]?.trim()
    if (!specialist) {
      throw createError({
        statusCode: 500,
        statusMessage: `No specialist configured for route "${step.route}"`,
      })
    }
    resolveRoutedModel(specialist, event)

    const { content } = await upstreamChatCompletion(
      event,
      specialist,
      {
        temperature: step.route === 'writing' ? 0.8 : 0.2,
        messages: [
          {
            role: 'system',
            content:
              `You are the ${step.route} specialist in a multi-part answer. `
              + 'Complete ONLY your assigned task. Do not do the other parts.',
          },
          {
            role: 'user',
            content:
              `Full user request:\n${prompt.slice(0, 6000)}\n\n`
              + `Your assigned task only:\n${step.brief}`,
          },
        ],
      },
      120_000,
    )

    return {
      index,
      route: step.route,
      specialist,
      content: content.trim() || '_(no content)_',
    }
  }))

  settled.sort((a, b) => a.index - b.index)
  for (const item of settled) {
    routes.push(item.route)
    models.push(item.specialist)
    sections.push(`${sectionHeading(item.route, item.index, settled.length)}${item.content}`)
  }

  setHeader(event, 'x-unaiter-route', routes.join(','))
  setHeader(event, 'x-unaiter-routed-model', models.join(','))
  setHeader(event, 'x-unaiter-orchestrated', 'true')

  return {
    kind: 'complete',
    response: buildMergedCompletion(config.publicModelId, sections),
  }
}

/** Virtual model row for GET /v1/models when the router is enabled. */
export function intentRouterModelListItem(event?: H3Event) {
  const config = readIntentRouterConfig(event)
  if (!config.enabled) {
    return null
  }
  return {
    id: config.publicModelId,
    object: 'model' as const,
    created: 0,
    owned_by: 'router',
    description:
      'Intent router: plans writing/code steps, runs specialists, merges multi-part answers',
  }
}
