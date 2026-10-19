<script setup lang="ts">
import type {
  ModelStatusFilter,
  ProviderModelPublic,
  ProviderPublic,
} from '~/types/providers'
import { apiErrorMessage } from '~/utils/apiError'
import { formatContextLength } from '~/utils/formatContextLength'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  provider: ProviderPublic | null
}>()

const emit = defineEmits<{
  refreshed: []
}>()

const toast = useToast()
const modelTests = useProviderModelTests()
const models = ref<ProviderModelPublic[]>([])
const loading = ref(false)
const fetching = ref(false)
const adding = ref(false)
const togglingId = ref<string | null>(null)
const deletingId = ref<string | null>(null)
const clearing = ref(false)
const deleteMode = ref(false)
const search = ref('')
const statusFilter = ref<ModelStatusFilter>('all')
const bulkOpen = ref(false)
const bulkText = ref('')
let stopModelUpdates: (() => void) | null = null
let stopDone: (() => void) | null = null

const statusItems = [
  { label: 'All', value: 'all' as const },
  { label: 'Enabled', value: 'enabled' as const },
  { label: 'Disabled', value: 'disabled' as const },
]

const testing = computed(() => modelTests.isTesting(props.provider?.id))
const testJob = computed(() => modelTests.jobFor(props.provider?.id))

const filteredModels = computed(() => {
  const query = search.value.trim().toLowerCase()
  return models.value.filter((model) => {
    if (statusFilter.value === 'enabled' && !model.enabled) {
      return false
    }
    if (statusFilter.value === 'disabled' && model.enabled) {
      return false
    }
    if (!query) {
      return true
    }
    return model.modelId.toLowerCase().includes(query)
  })
})

const counts = computed(() => ({
  all: models.value.length,
  enabled: models.value.filter(item => item.enabled).length,
  disabled: models.value.filter(item => !item.enabled).length,
}))

function detachTestListeners() {
  stopModelUpdates?.()
  stopDone?.()
  stopModelUpdates = null
  stopDone = null
}

function attachTestListeners(providerId: string) {
  detachTestListeners()
  stopModelUpdates = modelTests.onModelsUpdate(providerId, (update) => {
    if (update.models) {
      models.value = update.models
      return
    }
    if (!update.model) {
      return
    }
    const index = models.value.findIndex(item => item.id === update.model!.id)
    if (index === -1) {
      models.value.push(update.model)
      return
    }
    models.value[index] = update.model
  })
  stopDone = modelTests.onDone(providerId, (event) => {
    models.value = event.models
    emit('refreshed')
  })
}

watch(
  () => [open.value, props.provider?.id] as const,
  async ([isOpen, providerId]) => {
    if (!isOpen || !providerId) {
      detachTestListeners()
      if (!isOpen) {
        models.value = []
        search.value = ''
        statusFilter.value = 'all'
        bulkOpen.value = false
        bulkText.value = ''
        deleteMode.value = false
      }
      return
    }
    attachTestListeners(providerId)
    await loadModels()
    await modelTests.refreshStatus(providerId)
    statusFilter.value = models.value.some(model => model.enabled) ? 'enabled' : 'all'
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  detachTestListeners()
})

async function loadModels() {
  if (!props.provider) {
    return
  }
  loading.value = true
  try {
    const result = await $fetch<{ models: ProviderModelPublic[] }>(
      `/api/providers/${props.provider.id}/models`,
    )
    models.value = result.models
  }
  catch (err: unknown) {
    toast.add({
      title: 'Could not load models',
      description: apiErrorMessage(err),
      color: 'error',
    })
  }
  finally {
    loading.value = false
  }
}

async function fetchFromProvider() {
  if (!props.provider) {
    return
  }
  fetching.value = true
  try {
    const result = await $fetch<{
      models: ProviderModelPublic[]
      fetched: number
      added: number
      skippedExisting: number
    }>(`/api/providers/${props.provider.id}/models/fetch`, {
      method: 'POST',
    })
    models.value = result.models
    toast.add({
      title: 'Models retrieved',
      description: `Fetched ${result.fetched}, added ${result.added}, skipped ${result.skippedExisting} existing.`,
      color: 'success',
    })
    emit('refreshed')
  }
  catch (err: unknown) {
    toast.add({
      title: 'Could not retrieve models',
      description: apiErrorMessage(err),
      color: 'error',
    })
  }
  finally {
    fetching.value = false
  }
}

async function addBulk() {
  if (!props.provider) {
    return
  }
  adding.value = true
  try {
    const result = await $fetch<{
      models: ProviderModelPublic[]
      added: number
      skippedExisting: number
    }>(`/api/providers/${props.provider.id}/models`, {
      method: 'POST',
      body: { models: bulkText.value },
    })
    models.value = result.models
    bulkText.value = ''
    bulkOpen.value = false
    toast.add({
      title: 'Models added',
      description: `Added ${result.added}, skipped ${result.skippedExisting} existing.`,
      color: 'success',
    })
    emit('refreshed')
  }
  catch (err: unknown) {
    toast.add({
      title: 'Could not add models',
      description: apiErrorMessage(err),
      color: 'error',
    })
  }
  finally {
    adding.value = false
  }
}

async function testModels() {
  if (!props.provider) {
    return
  }
  await modelTests.startTest(props.provider.id)
}

async function cancelTestModels() {
  if (!props.provider) {
    return
  }
  await modelTests.cancelTest(props.provider.id, testJob.value.jobId)
}

async function toggleEnabled(model: ProviderModelPublic, enabled: boolean) {
  if (!props.provider) {
    return
  }
  const previous = model.enabled
  model.enabled = enabled
  togglingId.value = model.id
  try {
    await $fetch(`/api/providers/${props.provider.id}/models/${model.id}`, {
      method: 'PATCH',
      body: { enabled },
    })
    emit('refreshed')
  }
  catch (err: unknown) {
    model.enabled = previous
    toast.add({
      title: 'Could not update model',
      description: apiErrorMessage(err),
      color: 'error',
    })
  }
  finally {
    togglingId.value = null
  }
}

async function deleteModel(model: ProviderModelPublic) {
  if (!props.provider) {
    return
  }
  deletingId.value = model.id
  try {
    const result = await $fetch<{ models: ProviderModelPublic[] }>(
      `/api/providers/${props.provider.id}/models/${model.id}`,
      { method: 'DELETE' },
    )
    models.value = result.models
    emit('refreshed')
  }
  catch (err: unknown) {
    toast.add({
      title: 'Could not delete model',
      description: apiErrorMessage(err),
      color: 'error',
    })
  }
  finally {
    deletingId.value = null
  }
}

async function removeAllModels() {
  if (!props.provider) {
    return
  }
  clearing.value = true
  try {
    const result = await $fetch<{ models: ProviderModelPublic[]; removed: number }>(
      `/api/providers/${props.provider.id}/models`,
      { method: 'DELETE' },
    )
    models.value = result.models
    deleteMode.value = false
    toast.add({
      title: 'Models removed',
      description: `Cleared ${result.removed} model${result.removed === 1 ? '' : 's'}.`,
      color: 'success',
    })
    emit('refreshed')
  }
  catch (err: unknown) {
    toast.add({
      title: 'Could not remove models',
      description: apiErrorMessage(err),
      color: 'error',
    })
  }
  finally {
    clearing.value = false
  }
}

function publicModelId(model: ProviderModelPublic) {
  return props.provider ? `${props.provider.slug}/${model.modelId}` : model.modelId
}

/** Click-through toast; only the close control receives pointer events.
 * The Toaster merges its own `base` slot (`pointer-events-auto`) onto the same
 * element as the toast `root`, so the plain utility loses the merge. The
 * Tailwind v4 important modifier (`!`) is required to win. */
const copyToastUi = {
  root: 'pointer-events-none!',
  close: 'pointer-events-auto!',
}

async function copyModelId(model: ProviderModelPublic) {
  const value = publicModelId(model)
  try {
    await navigator.clipboard.writeText(value)
    toast.add({
      title: 'Copied',
      description: value,
      color: 'success',
      ui: copyToastUi,
      close: { class: 'pointer-events-auto' },
    })
  }
  catch {
    toast.add({
      title: 'Could not copy',
      description: value,
      color: 'error',
      ui: copyToastUi,
      close: { class: 'pointer-events-auto' },
    })
  }
}
</script>

<template>
  <UDrawer
    v-model:open="open"
    direction="right"
    :handle="false"
    :title="provider ? `${provider.name} models` : 'Models'"
    :description="provider
      ? 'Enabled models appear on GET /v1/models. Disabled stay hidden.'
      : undefined"
    :ui="{ content: 'sm:max-w-lg' }"
  >
    <template #body>
      <div class="space-y-4">
        <div class="flex flex-wrap gap-2">
          <UButton
            label="Retrieve from /models"
            icon="i-lucide-cloud-download"
            size="sm"
            :loading="fetching"
            :disabled="loading || testing || adding"
            @click="fetchFromProvider"
          />
          <UButton
            label="Add in bulk"
            icon="i-lucide-list-plus"
            size="sm"
            color="neutral"
            variant="soft"
            :disabled="loading || fetching || testing"
            @click="bulkOpen = !bulkOpen"
          />
          <UButton
            v-if="!testing"
            label="Test models"
            icon="i-lucide-flask-conical"
            size="sm"
            color="neutral"
            variant="outline"
            :disabled="loading || fetching || adding || !counts.all"
            @click="testModels"
          />
          <UButton
            v-else
            label="Cancel test"
            icon="i-lucide-square"
            size="sm"
            color="error"
            variant="soft"
            @click="cancelTestModels"
          />
        </div>

        <p
          v-if="testing"
          class="text-xs text-muted"
        >
          <template v-if="testJob.status === 'queued'">
            Job #{{ testJob.jobId }} queued — waiting for this provider’s current test.
          </template>
          <template v-else>
            Job #{{ testJob.jobId }} testing in the background…
            {{ testJob.tested }}/{{ testJob.total }}
            ({{ testJob.passed }} passed · {{ testJob.failed }} failed).
          </template>
          You can close this drawer and come back.
        </p>

        <div
          v-if="bulkOpen"
          class="space-y-2 rounded-md border border-default p-3"
        >
          <p class="text-sm text-muted">
            One model id per line. Duplicates are skipped.
          </p>
          <UTextarea
            v-model="bulkText"
            :rows="6"
            autoresize
            placeholder="gpt-4o&#10;claude-3-5-sonnet&#10;openai/gpt-4.1"
            class="w-full font-mono text-sm"
          />
          <div class="flex justify-end gap-2">
            <UButton
              label="Cancel"
              color="neutral"
              variant="ghost"
              size="sm"
              :disabled="adding"
              @click="bulkOpen = false"
            />
            <UButton
              label="Add models"
              size="sm"
              :loading="adding"
              :disabled="!bulkText.trim()"
              @click="addBulk"
            />
          </div>
        </div>

        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
          <UInput
            v-model="search"
            icon="i-lucide-search"
            placeholder="Search models…"
            class="w-full"
            size="sm"
          />
          <UTabs
            v-model="statusFilter"
            :items="statusItems"
            :content="false"
            size="sm"
            color="neutral"
            class="shrink-0"
          />
        </div>

        <div class="flex items-center justify-between gap-2">
          <p class="text-xs text-muted">
            Showing {{ filteredModels.length }} of {{ counts.all }}
            ({{ counts.enabled }} enabled · {{ counts.disabled }} disabled)
          </p>
          <div
            v-if="!deleteMode"
            class="shrink-0"
          >
            <UButton
              label="Enable delete?"
              size="xs"
              color="neutral"
              variant="ghost"
              :disabled="loading || !counts.all"
              @click="deleteMode = true"
            />
          </div>
          <div
            v-else
            class="flex items-center gap-0.5 shrink-0 rounded-md border border-default bg-elevated p-0.5"
          >
            <UButton
              label="Remove all"
              size="xs"
              color="error"
              variant="soft"
              class="bg-red-100! hover:bg-red-200! dark:bg-red-950! dark:hover:bg-red-900!"
              :loading="clearing"
              :disabled="loading || !counts.all || !!deletingId"
              @click="removeAllModels"
            />
            <UButton
              icon="i-lucide-x"
              size="xs"
              color="neutral"
              variant="soft"
              aria-label="Cancel delete mode"
              :disabled="clearing || !!deletingId"
              @click="deleteMode = false"
            />
          </div>
        </div>

        <div
          v-if="loading"
          class="text-sm text-muted"
        >
          Loading models…
        </div>

        <ul
          v-else-if="filteredModels.length"
          class="max-h-[60vh] overflow-y-auto rounded-md border border-default divide-y divide-default"
        >
          <li
            v-for="model in filteredModels"
            :key="model.id"
            class="flex items-center justify-between gap-3 px-3 py-2 text-sm"
          >
            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 items-center gap-2">
                <p class="min-w-0 flex-1 font-mono text-highlighted truncate">
                  {{ publicModelId(model) }}
                </p>
                <div
                  v-if="model.tasks?.length"
                  class="flex shrink-0 flex-wrap justify-end gap-1"
                >
                  <span
                    v-for="task in model.tasks"
                    :key="task"
                    class="rounded bg-elevated px-1.5 py-0.5 font-mono text-[0.65rem] text-muted"
                  >
                    {{ task }}
                  </span>
                </div>
              </div>
              <p
                v-if="model.contextLength"
                class="text-xs text-muted"
              >
                {{ formatContextLength(model.contextLength) }} ctx
              </p>
              <p class="text-xs text-muted">
                {{ model.source }}
                <template v-if="model.lastTestOk !== null">
                  · last test {{ model.lastTestOk ? 'ok' : 'failed' }}
                </template>
              </p>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <template v-if="deleteMode">
                <UButton
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  size="xs"
                  :aria-label="`Delete ${publicModelId(model)}`"
                  :loading="deletingId === model.id"
                  :disabled="clearing || (!!deletingId && deletingId !== model.id)"
                  @click="deleteModel(model)"
                />
              </template>
              <template v-else>
                <UButton
                  icon="i-lucide-copy"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :aria-label="`Copy ${publicModelId(model)}`"
                  @click="copyModelId(model)"
                />
                <USwitch
                  :model-value="model.enabled"
                  :loading="togglingId === model.id"
                  size="sm"
                  aria-label="Toggle model enabled"
                  @update:model-value="(value: boolean) => toggleEnabled(model, value)"
                />
              </template>
            </div>
          </li>
        </ul>

        <p
          v-else
          class="text-sm text-muted"
        >
          {{ counts.all ? 'No models match this filter.' : 'No models yet. Retrieve from the provider or add in bulk.' }}
        </p>
      </div>
    </template>
  </UDrawer>
</template>
