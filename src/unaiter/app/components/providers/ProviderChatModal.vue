<script setup lang="ts">
import type {
  ModelStatusFilter,
  ModelTask,
  ProviderModelPublic,
  ProviderPublic,
} from '~/types/providers'
import { apiErrorMessage } from '~/utils/apiError'

type ChatModelMenuItem = {
  label: string
  value: string
  modelId: string
  tasks: ModelTask[]
  /** Non-generate hats stay visible but cannot be selected for chat. */
  disabled?: boolean
}

function modelHasGenerate(model: ProviderModelPublic) {
  return (model.tasks ?? []).includes('generate')
}

/** Unlabelled models (no tasks yet) stay selectable so chat can probe them. */
function modelIsChatSelectable(model: ProviderModelPublic) {
  const tasks = model.tasks ?? []
  if (tasks.length === 0) {
    return true
  }
  return modelHasGenerate(model)
}

/** Selectable first (generate, then unlabelled); non-chat hats last. */
function sortChatModels(list: ProviderModelPublic[]) {
  return [...list].sort((a, b) => {
    const rank = (model: ProviderModelPublic) => {
      if (modelHasGenerate(model)) {
        return 0
      }
      if ((model.tasks ?? []).length === 0) {
        return 1
      }
      return 2
    }
    const byRank = rank(a) - rank(b)
    if (byRank !== 0) {
      return byRank
    }
    const enabled = Number(b.enabled) - Number(a.enabled)
    if (enabled !== 0) {
      return enabled
    }
    return a.modelId.localeCompare(b.modelId)
  })
}

function firstSelectableModel(list: ProviderModelPublic[]) {
  return list.find(modelIsChatSelectable) ?? null
}

type ChatRole = 'user' | 'assistant' | 'system'

type ChatMessage = {
  role: ChatRole
  content: string
  /** Chain-of-thought streamed separately from the answer, when the model emits it. */
  reasoning?: string
  /** Whether the reasoning block is expanded. */
  showReasoning?: boolean
}

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  provider: ProviderPublic | null
}>()

const models = ref<ProviderModelPublic[]>([])
const loadingModels = ref(false)
const selectedModel = ref<string | null>(null)
const statusFilter = ref<ModelStatusFilter>('all')
const messages = ref<ChatMessage[]>([])
const prompt = ref('')
const sending = ref(false)

const toast = useToast()
const controller = ref<AbortController | null>(null)
const scrollRef = ref<HTMLElement | null>(null)

const statusItems = [
  { label: 'All', value: 'all' as const },
  { label: 'Enabled', value: 'enabled' as const },
  { label: 'Disabled', value: 'disabled' as const },
]

const filteredModels = computed(() =>
  models.value.filter((model) => {
    if (statusFilter.value === 'enabled') {
      return model.enabled
    }
    if (statusFilter.value === 'disabled') {
      return !model.enabled
    }
    return true
  }),
)

const modelItems = computed((): ChatModelMenuItem[] =>
  sortChatModels(filteredModels.value).map((model) => {
    const tasks = model.tasks ?? []
    const selectable = modelIsChatSelectable(model)
    return {
      label: tasks.length
        ? `${model.modelId} · ${tasks.join(', ')}`
        : model.modelId,
      value: model.modelId,
      modelId: model.modelId,
      tasks,
      disabled: !selectable,
    }
  }),
)

const hasModels = computed(() => models.value.length > 0)

/** USelectMenu may hand back the item object if value-key is missing — normalise. */
function selectedModelId(): string | null {
  const raw = selectedModel.value as string | { value?: string } | null
  if (!raw) {
    return null
  }
  if (typeof raw === 'string') {
    return raw
  }
  return typeof raw.value === 'string' ? raw.value : null
}

const canSend = computed(() => {
  const id = selectedModelId()
  if (!id || !prompt.value.trim() || sending.value) {
    return false
  }
  const model = models.value.find(item => item.modelId === id)
  return !!model && modelIsChatSelectable(model)
})

/** Only the last assistant message is ever mid-stream; render Markdown once done. */
function isStreamingMessage(index: number) {
  return sending.value
    && messages.value.at(-1)?.role === 'assistant'
    && index === messages.value.length - 1
}

watch(
  () => [open.value, props.provider?.id] as const,
  async ([isOpen, providerId]) => {
    if (!isOpen) {
      abort()
      messages.value = []
      prompt.value = ''
      models.value = []
      selectedModel.value = null
      statusFilter.value = 'all'
      return
    }
    if (providerId) {
      await loadModels(providerId)
    }
  },
  { immediate: true },
)

watch(
  () => messages.value.length,
  () => scrollToBottom(),
)

// When the filter hides the current selection, move to the first chat-capable model.
watch(statusFilter, () => {
  const visible = sortChatModels(filteredModels.value)
  const current = selectedModelId()
  if (current && visible.some(model => model.modelId === current && modelIsChatSelectable(model))) {
    return
  }
  selectedModel.value = firstSelectableModel(visible)?.modelId ?? null
})

async function loadModels(providerId: string) {
  loadingModels.value = true
  selectedModel.value = null
  statusFilter.value = 'all'
  models.value = []
  try {
    const result = await $fetch<{ models: ProviderModelPublic[] }>(
      `/api/providers/${providerId}/models`,
    )
    // Generate hats first; auto-select the first chat-capable model.
    const sorted = sortChatModels(result.models)
    models.value = sorted
    statusFilter.value = sorted.some(model => model.enabled) ? 'enabled' : 'all'
    const first = firstSelectableModel(sortChatModels(
      statusFilter.value === 'enabled'
        ? sorted.filter(model => model.enabled)
        : sorted,
    ))
    selectedModel.value = first?.modelId ?? null
  }
  catch (err: unknown) {
    toast.add({
      title: 'Could not load models',
      description: apiErrorMessage(err),
      color: 'error',
    })
  }
  finally {
    loadingModels.value = false
  }
}

function publicModelId() {
  const modelId = selectedModelId()
  return props.provider && modelId
    ? `${props.provider.slug}/${modelId}`
    : null
}

async function scrollToBottom() {
  await nextTick()
  if (scrollRef.value) {
    scrollRef.value.scrollTop = scrollRef.value.scrollHeight
  }
}

function abort() {
  controller.value?.abort()
  controller.value = null
  sending.value = false
}

async function send() {
  const model = publicModelId()
  const text = prompt.value.trim()
  if (!model || !text || sending.value) {
    return
  }

  messages.value.push({ role: 'user', content: text })
  prompt.value = ''
  sending.value = true

  // Push first, then keep the array index — Vue wraps the object in a proxy, so
  // indexOf(rawObject) would miss and streaming updates would silently no-op.
  const assistantIndex = messages.value.push({ role: 'assistant', content: '' }) - 1

  const payload = messages.value
    .filter(message => message.content.trim().length > 0)
    .map(message => ({ role: message.role, content: message.content }))

  controller.value = new AbortController()
  try {
    const response = await fetch('/api/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: payload, stream: true }),
      signal: controller.value.signal,
    })

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '')
      let summary = detail.slice(0, 280)
      try {
        const parsed = JSON.parse(detail) as {
          statusMessage?: string
          message?: string
          error?: { message?: string }
        }
        summary = parsed.error?.message || parsed.statusMessage || parsed.message || summary
      }
      catch {
        // keep raw body snippet
      }
      throw new Error(summary || `Request failed (${response.status})`)
    }

    await readStream(response.body, assistantIndex)
  }
  catch (err: unknown) {
    if ((err as Error)?.name !== 'AbortError') {
      toast.add({
        title: 'Chat request failed',
        description: err instanceof Error ? err.message : apiErrorMessage(err),
        color: 'error',
      })
      const assistant = messages.value[assistantIndex]
      if (assistant && !assistant.content) {
        messages.value.splice(assistantIndex, 1)
      }
    }
  }
  finally {
    sending.value = false
    controller.value = null
    void scrollToBottom()
  }
}

async function readStream(body: ReadableStream<Uint8Array>, assistantIndex: number) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    buffer += decoder.decode(value, { stream: true })

    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''

    for (const event of events) {
      for (const line of event.split('\n')) {
        const data = line.startsWith('data:') ? line.slice(5).trim() : ''
        if (!data || data === '[DONE]') {
          continue
        }
        try {
          const parsed = JSON.parse(data) as {
            error?: { message?: string, type?: string }
            choices?: Array<{
              delta?: { content?: string, reasoning_content?: string, reasoning?: string }
              message?: { content?: string, reasoning_content?: string }
            }>
          }
          if (parsed.error?.message) {
            throw new Error(parsed.error.message)
          }
          const live = messages.value[assistantIndex]
          if (!live) {
            continue
          }
          const delta = parsed.choices?.[0]?.delta
          const message = parsed.choices?.[0]?.message
          const chunk = delta?.content ?? message?.content
          const reasoning = delta?.reasoning_content ?? delta?.reasoning ?? message?.reasoning_content
          if (reasoning) {
            live.reasoning = (live.reasoning ?? '') + reasoning
            // Reveal the chain-of-thought while it streams; still user-collapsible.
            if (live.showReasoning === undefined) {
              live.showReasoning = true
            }
            void scrollToBottom()
          }
          if (chunk) {
            live.content += chunk
            void scrollToBottom()
          }
        }
        catch (err) {
          // Ignore keep-alive / non-JSON frames; re-throw real stream errors.
          if (err instanceof SyntaxError) {
            continue
          }
          throw err
        }
      }
    }
  }
}

function stop() {
  abort()
}

function clearChat() {
  abort()
  messages.value = []
}

function toggleReasoning(message: ChatMessage) {
  message.showReasoning = !message.showReasoning
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="provider ? `Chat with ${provider.name}` : 'Chat'"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <div
          v-if="loadingModels"
          class="text-sm text-muted"
        >
          Loading models…
        </div>

        <p
          v-else-if="!hasModels"
          class="text-sm text-muted"
        >
          No models available for this provider. Add or enable models first.
        </p>

        <UTabs
          v-if="hasModels"
          v-model="statusFilter"
          :items="statusItems"
          :content="false"
          size="sm"
          color="neutral"
          :ui="{ root: 'w-full', list: 'w-full', trigger: 'flex-1 justify-center' }"
        />

        <USelectMenu
          v-if="hasModels"
          v-model="selectedModel"
          :items="modelItems"
          value-key="value"
          label-key="label"
          placeholder="Select a model"
          :search-input="{ placeholder: 'Search models...' }"
          :disabled="sending"
          class="w-full"
        >
          <template #item="{ item }">
            <div
              class="flex w-full min-w-0 items-center gap-2"
              :class="(item as ChatModelMenuItem).disabled ? 'opacity-50' : ''"
            >
              <span class="min-w-0 flex-1 truncate font-mono text-sm">
                {{ (item as ChatModelMenuItem).modelId }}
              </span>
              <div
                v-if="(item as ChatModelMenuItem).tasks.length"
                class="flex shrink-0 flex-wrap justify-end gap-1"
              >
                <span
                  v-for="task in (item as ChatModelMenuItem).tasks"
                  :key="task"
                  class="rounded bg-elevated px-1.5 py-0.5 font-mono text-[0.65rem] text-muted"
                >
                  {{ task }}
                </span>
              </div>
            </div>
          </template>
        </USelectMenu>

        <div
          ref="scrollRef"
          class="flex flex-col gap-3 overflow-y-auto rounded-md border border-default p-3 min-h-40 max-h-[45vh]"
        >
          <p
            v-if="!messages.length"
            class="text-sm text-muted"
          >
            No messages yet. Pick a model and ask something.
          </p>

          <div
            v-for="(message, index) in messages"
            :key="index"
            class="flex"
            :class="message.role === 'user' ? 'justify-end' : 'justify-start'"
          >
            <div
              class="max-w-[85%] rounded-lg px-3 py-2 text-sm"
              :class="message.role === 'user'
                ? 'bg-primary/10 text-highlighted whitespace-pre-wrap break-words'
                : 'bg-elevated text-default'"
            >
              <!-- Chain-of-thought: only rendered when the model actually emits
                   it, and always toggleable. -->
              <div
                v-if="message.role === 'assistant' && message.reasoning"
                class="mb-2 border-l-2 border-default pl-2"
              >
                <button
                  type="button"
                  class="flex items-center gap-1 text-xs text-muted hover:text-default"
                  @click="toggleReasoning(message)"
                >
                  <UIcon
                    :name="message.showReasoning ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                    class="size-3.5"
                  />
                  <span>{{ isStreamingMessage(index) && !message.content ? 'Thinking…' : 'Reasoning' }}</span>
                </button>
                <div
                  v-if="message.showReasoning"
                  class="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-xs text-muted"
                >
                  {{ message.reasoning }}
                </div>
              </div>

              <!-- Assistant replies render as Markdown (streaming replies stay
                   plain text inside the component until they finish). -->
              <ProvidersProviderChatMarkdown
                v-if="message.role === 'assistant'"
                :content="message.content"
                :streaming="isStreamingMessage(index)"
              />
              <span v-else>{{ message.content }}</span>
            </div>
          </div>
        </div>

        <UTextarea
          v-model="prompt"
          :rows="3"
          autoresize
          :disabled="sending || !hasModels"
          placeholder="Type a message…"
          class="w-full"
          @keydown.enter.exact.prevent="send"
        />
      </div>
    </template>

    <template #footer="{ close }">
      <div class="flex items-center justify-between gap-2 w-full">
        <UButton
          label="Clear"
          color="neutral"
          variant="ghost"
          icon="i-lucide-eraser"
          :disabled="!messages.length || sending"
          @click="clearChat"
        />
        <div class="flex items-center gap-2">
          <UButton
            label="Close"
            color="neutral"
            variant="ghost"
            @click="close()"
          />
          <UButton
            v-if="sending"
            label="Stop"
            color="error"
            variant="soft"
            icon="i-lucide-square"
            @click="stop"
          />
          <UButton
            v-else
            label="Send"
            icon="i-lucide-send"
            :disabled="!canSend"
            @click="send"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
