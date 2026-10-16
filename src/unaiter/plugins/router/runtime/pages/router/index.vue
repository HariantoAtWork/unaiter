<script setup lang="ts">
import type { IntentRouterPublic } from '#router-shared/types'
import { apiErrorMessage } from '~/utils/apiError'

useHead({ title: 'Router · Una Iter' })

const toast = useToast()
const { data, refresh, status } = useRouterConfig()

const saving = ref(false)
const form = reactive({
  enabled: true,
  publicModelId: 'router/auto',
  classifierModelId: '',
  writingModelId: '',
  codeModelId: '',
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
  { immediate: true },
)

const { data: modelsData } = await useFetch<{ data: Array<{ id: string }> }>('/v1/models')

const modelItems = computed(() => {
  const ids = (modelsData.value?.data ?? [])
    .map(item => item.id)
    .filter(id => !id.startsWith('router/'))
    .sort((a, b) => a.localeCompare(b))
  return ids.map(id => ({ label: id, value: id }))
})

async function save() {
  saving.value = true
  try {
    await $fetch<IntentRouterPublic>('/api/router/config', {
      method: 'PUT',
      body: {
        enabled: form.enabled,
        publicModelId: form.publicModelId.trim(),
        classifierModelId: form.classifierModelId.trim(),
        routes: {
          writing: form.writingModelId.trim(),
          code: form.codeModelId.trim(),
        },
      },
    })
    await refresh()
    toast.add({ title: 'Router saved', color: 'success' })
  }
  catch (err: unknown) {
    toast.add({
      title: 'Could not save router',
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
      <UDashboardNavbar title="Router" />
    </template>

    <template #body>
      <div class="space-y-6 max-w-2xl">
        <div>
          <h1 class="text-xl font-semibold text-highlighted">
            Intent router
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
                :disabled="!form.publicModelId.trim() || !form.classifierModelId || !form.writingModelId || !form.codeModelId"
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
