<script setup lang="ts">
import type { IntentRouterPublic } from '#router-shared/types'
import { apiErrorMessage } from '~/utils/apiError'

useHead({ title: 'Auto · Una Iter' })

const toast = useToast()
const { data, refresh, status } = await useFetch<IntentRouterPublic>('/api/auto/config')
const { data: catalogueData } = await useFetch<{
  models: Array<{ id: string, enabled: boolean }>
}>('/api/router/catalogue')

const saving = ref(false)
const form = reactive({
  enabled: data.value?.enabled ?? true,
  publicModelId: data.value?.publicModelId ?? 'router/auto',
  classifierModelId: data.value?.classifierModelId ?? '',
  writingModelId: data.value?.routes.writing ?? '',
  codeModelId: data.value?.routes.code ?? '',
})

watch(
  data,
  (value) => {
    if (!value) {
      return
    }
    form.enabled = value.enabled
    form.publicModelId = value.publicModelId
    form.classifierModelId = value.classifierModelId
    form.writingModelId = value.routes.writing
    form.codeModelId = value.routes.code
  },
)

function modelId(value: unknown) {
  if (typeof value === 'string') {
    return value.trim()
  }
  if (value && typeof value === 'object' && 'value' in value) {
    const inner = (value as { value?: unknown }).value
    return typeof inner === 'string' ? inner.trim() : ''
  }
  return ''
}

const modelItems = computed(() => {
  const selected = new Set([
    form.classifierModelId,
    form.writingModelId,
    form.codeModelId,
  ].map(modelId).filter(Boolean))

  const ids = new Set<string>()
  for (const item of catalogueData.value?.models ?? []) {
    if (item.enabled || selected.has(item.id)) {
      ids.add(item.id)
    }
  }
  for (const id of selected) {
    ids.add(id)
  }
  return [...ids].sort((a, b) => a.localeCompare(b)).map(id => ({
    label: id,
    value: id,
  }))
})

const canSave = computed(() =>
  !!form.publicModelId.trim()
  && !!modelId(form.classifierModelId)
  && !!modelId(form.writingModelId)
  && !!modelId(form.codeModelId)
  && !saving.value,
)

async function save() {
  saving.value = true
  try {
    await $fetch<IntentRouterPublic>('/api/auto/config', {
      method: 'PUT',
      body: {
        enabled: form.enabled,
        publicModelId: form.publicModelId.trim(),
        classifierModelId: modelId(form.classifierModelId),
        routes: {
          writing: modelId(form.writingModelId),
          code: modelId(form.codeModelId),
        },
      },
    })
    await refresh()
    toast.add({ title: 'Auto router saved', color: 'success' })
  }
  catch (err: unknown) {
    toast.add({
      title: 'Could not save auto router',
      description: apiErrorMessage(err),
      color: 'error',
    })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="Auto" />
    </template>

    <template #body>
      <div class="space-y-6 max-w-2xl">
        <div>
          <h1 class="text-xl font-semibold text-highlighted">
            Intent auto-router
          </h1>
          <p class="text-sm text-muted mt-1">
            Clients call
            <code class="text-xs">{{ form.publicModelId || 'router/auto' }}</code>
            on
            <code class="text-xs">POST /v1/chat/completions</code>.
            A small planner splits the prompt into
            <code class="text-xs">writing</code>
            /
            <code class="text-xs">code</code>
            steps. One step streams to a specialist; several steps run in parallel and merge (non-streaming).
          </p>
        </div>

        <div
          v-if="status === 'pending' && !data"
          class="text-sm text-muted"
        >
          Loading…
        </div>

        <UCard v-else>
          <form
            class="space-y-5"
            @submit.prevent="save"
          >
            <UFormField label="Enabled">
              <USwitch v-model="form.enabled" />
              <template #hint>
                When off,
                <code class="text-xs">{{ form.publicModelId }}</code>
                is hidden from
                <code class="text-xs">GET /v1/models</code>
                and completions reject it.
              </template>
            </UFormField>

            <UFormField
              label="Public model id"
              required
            >
              <UInput
                v-model="form.publicModelId"
                placeholder="router/auto"
                class="w-full"
              />
            </UFormField>

            <UFormField
              label="Classifier model"
              required
              hint="Small/fast model that plans writing/code steps (and briefs)."
            >
              <USelect
                v-model="form.classifierModelId"
                :items="modelItems"
                value-key="value"
                label-key="label"
                placeholder="Select a model"
                class="w-full"
              />
            </UFormField>

            <UFormField
              label="Writing specialist"
              required
              hint="Poems, prose, creative language."
            >
              <USelect
                v-model="form.writingModelId"
                :items="modelItems"
                value-key="value"
                label-key="label"
                placeholder="Select a model"
                class="w-full"
              />
            </UFormField>

            <UFormField
              label="Code specialist"
              required
              hint="Code, logs, refactoring, debugging. Also the fail-open default."
            >
              <USelect
                v-model="form.codeModelId"
                :items="modelItems"
                value-key="value"
                label-key="label"
                placeholder="Select a model"
                class="w-full"
              />
            </UFormField>

            <div class="flex items-center gap-3 pt-2">
              <UButton
                type="submit"
                label="Save"
                icon="i-lucide-save"
                :loading="saving"
                :disabled="!canSave"
              />
              <p
                v-if="data?.updatedAt"
                class="text-xs text-muted"
              >
                Last saved {{ data.updatedAt }}
              </p>
            </div>
          </form>
        </UCard>

        <RouterTryChat
          :model-id="form.publicModelId"
          :disabled="!form.enabled || !form.publicModelId.trim()"
        />

        <UCard>
          <template #header>
            <h2 class="font-semibold text-highlighted">
              Client example
            </h2>
          </template>
          <pre class="text-xs overflow-x-auto whitespace-pre-wrap text-muted">POST /v1/chat/completions
{
  "model": "{{ form.publicModelId || 'router/auto' }}",
  "messages": [{
    "role": "user",
    "content": "Kan je me een gedicht schrijven, en vervolgens Javascript code voor een stuiterende bal."
  }]
}

→ plan: writing + code
→ {{ form.writingModelId || '…' }} and {{ form.codeModelId || '…' }} in parallel
→ merged sections in one reply (stream:false)
Headers: x-unaiter-route, x-unaiter-routed-model, x-unaiter-orchestrated</pre>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
