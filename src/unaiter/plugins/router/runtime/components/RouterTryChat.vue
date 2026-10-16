<script setup lang="ts">
import { apiErrorMessage } from '~/utils/apiError'

type ChatRole = 'user' | 'assistant'

type ChatMessage = {
  role: ChatRole
  content: string
}

type RouteMeta = {
  route: string | null
  routedModel: string | null
  orchestrated: string | null
}

const SAMPLE_PROMPT
  = 'Kan je me een gedicht schrijven, en vervolgens Javascript code voor een stuiterende bal.'

const props = withDefaults(defineProps<{
  modelId: string
  disabled?: boolean
}>(), {
  disabled: false,
})

const toast = useToast()
const messages = ref<ChatMessage[]>([])
const prompt = ref('')
const sending = ref(false)
const routeMeta = ref<RouteMeta | null>(null)
const controller = ref<AbortController | null>(null)
const scrollRef = ref<HTMLElement | null>(null)

const canSend = computed(() =>
  !props.disabled
  && !!props.modelId.trim()
  && !!prompt.value.trim()
  && !sending.value,
)

watch(
  () => messages.value.length,
  () => scrollToBottom(),
)

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

function fillSample() {
  prompt.value = SAMPLE_PROMPT
}

function clearChat() {
  abort()
  messages.value = []
  routeMeta.value = null
}

function stop() {
  abort()
}

function messageContent(raw: unknown): string {
  if (typeof raw === 'string') {
    return raw
  }
  if (Array.isArray(raw)) {
    return raw
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

async function send() {
  const model = props.modelId.trim()
  const text = prompt.value.trim()
  if (!model || !text || sending.value || props.disabled) {
    return
  }

  messages.value.push({ role: 'user', content: text })
  prompt.value = ''
  sending.value = true
  routeMeta.value = null

  const assistant: ChatMessage = { role: 'assistant', content: '' }
  messages.value.push(assistant)

  const payload = messages.value
    .filter(message => message.content.trim().length > 0)
    .map(message => ({ role: message.role, content: message.content }))

  controller.value = new AbortController()
  try {
    const response = await fetch('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: payload, stream: false }),
      signal: controller.value.signal,
    })

    routeMeta.value = {
      route: response.headers.get('x-unaiter-route'),
      routedModel: response.headers.get('x-unaiter-routed-model'),
      orchestrated: response.headers.get('x-unaiter-orchestrated'),
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(detail || `Request failed (${response.status})`)
    }

    const json = await response.json() as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    const content = messageContent(json.choices?.[0]?.message?.content).trim()
    const live = messages.value[messages.value.indexOf(assistant)]
    if (live) {
      live.content = content || '_(empty reply)_'
    }
  }
  catch (err: unknown) {
    if ((err as Error)?.name !== 'AbortError') {
      toast.add({
        title: 'Router chat failed',
        description: err instanceof Error ? err.message : apiErrorMessage(err),
        color: 'error',
      })
      if (!assistant.content) {
        messages.value = messages.value.filter(message => message !== assistant)
      }
    }
  }
  finally {
    sending.value = false
    controller.value = null
    void scrollToBottom()
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 class="font-semibold text-highlighted">
            Try chat
          </h2>
          <p class="text-xs text-muted mt-0.5">
            Calls
            <code class="text-xs">{{ modelId || 'router/auto' }}</code>
            with
            <code class="text-xs">stream: false</code>
            so multi-step orchestration works.
          </p>
        </div>
        <UButton
          label="Sample prompt"
          color="neutral"
          variant="soft"
          size="sm"
          icon="i-lucide-sparkles"
          :disabled="disabled || sending"
          @click="fillSample"
        />
      </div>
    </template>

    <div class="flex flex-col gap-3">
      <p
        v-if="disabled"
        class="text-sm text-muted"
      >
        Enable the router and save before testing.
      </p>

      <div
        ref="scrollRef"
        class="flex flex-col gap-3 overflow-y-auto rounded-md border border-default p-3 min-h-40 max-h-[45vh]"
      >
        <p
          v-if="!messages.length"
          class="text-sm text-muted"
        >
          No messages yet. Ask for writing, code, or both.
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
            <ProvidersProviderChatMarkdown
              v-if="message.role === 'assistant'"
              :content="message.content"
              :streaming="sending && index === messages.length - 1 && !message.content"
            />
            <span v-else>{{ message.content }}</span>
          </div>
        </div>
      </div>

      <div
        v-if="routeMeta"
        class="rounded-md border border-default bg-elevated/50 px-3 py-2 text-xs text-muted space-y-1"
      >
        <p>
          <span class="text-highlighted">Route:</span>
          {{ routeMeta.route || '—' }}
        </p>
        <p>
          <span class="text-highlighted">Model:</span>
          {{ routeMeta.routedModel || '—' }}
        </p>
        <p>
          <span class="text-highlighted">Orchestrated:</span>
          {{ routeMeta.orchestrated || '—' }}
        </p>
      </div>

      <UTextarea
        v-model="prompt"
        :rows="3"
        autoresize
        :disabled="disabled || sending"
        placeholder="Type a message…"
        class="w-full"
        @keydown.enter.exact.prevent="send"
      />

      <div class="flex items-center justify-between gap-2">
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
    </div>
  </UCard>
</template>
