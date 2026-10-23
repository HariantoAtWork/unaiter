<script setup lang="ts">
import type {
  CatalogueModel,
  CustomRoutePublic,
  ModelStatusFilter,
} from '#router-shared/types'
import { apiErrorMessage } from '~/utils/apiError'

type ModelView = 'operational' | 'view'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  route: CustomRoutePublic | null
}>()

const emit = defineEmits<{
  saved: []
}>()

const toast = useToast()
const saving = ref(false)
const catalogue = ref<CatalogueModel[]>([])
const loadingCatalogue = ref(false)
const search = ref('')
const statusFilter = ref<ModelStatusFilter>('all')
const modelView = ref<ModelView>('operational')

const form = reactive({
  name: '',
  slug: '',
  modelIds: [] as string[],
})

const isEdit = computed(() => !!props.route)
const title = computed(() => (isEdit.value ? 'Edit route' : 'Add route'))

const statusItems = [
  { label: 'All', value: 'all' as const },
  { label: 'Enabled', value: 'enabled' as const },
  { label: 'Disabled', value: 'disabled' as const },
]

const filteredCatalogue = computed(() => {
  const query = search.value.trim().toLowerCase()
  return catalogue.value.filter((model) => {
    if (statusFilter.value === 'enabled' && !model.enabled) {
      return false
    }
    if (statusFilter.value === 'disabled' && model.enabled) {
      return false
    }
    if (!query) {
      return true
    }
    return model.id.toLowerCase().includes(query)
      || model.providerName.toLowerCase().includes(query)
  })
})

const selectedSet = computed(() => new Set(form.modelIds))

/** The route's published models: attached ids that still exist and are enabled. */
const viewModels = computed(() =>
  catalogue.value.filter(model => model.enabled && selectedSet.value.has(model.id)),
)

function toggleModelView() {
  modelView.value = modelView.value === 'operational' ? 'view' : 'operational'
}

const canSave = computed(() =>
  !!form.name.trim()
  && !!form.slug.trim()
  && !saving.value,
)

watch(
  () => [open.value, props.route?.id] as const,
  async ([isOpen]) => {
    if (!isOpen) {
      return
    }
    form.name = props.route?.name ?? ''
    form.slug = props.route?.slug ?? ''
    form.modelIds = props.route ? [...props.route.modelIds] : []
    search.value = ''
    statusFilter.value = 'enabled'
    modelView.value = form.modelIds.length ? 'view' : 'operational'
    await loadCatalogue()
  },
  // Required for the URL-restore path: the parent can mount this component already
  // open, and a non-immediate watcher would never fire.
  { immediate: true },
)

async function loadCatalogue() {
  loadingCatalogue.value = true
  try {
    const result = await $fetch<{ models: CatalogueModel[] }>('/api/router/catalogue')
    catalogue.value = result.models
  }
  catch (err: unknown) {
    toast.add({
      title: 'Could not load models',
      description: apiErrorMessage(err),
      color: 'error',
    })
  }
  finally {
    loadingCatalogue.value = false
  }
}

function toggleModel(id: string) {
  const index = form.modelIds.indexOf(id)
  if (index === -1) {
    form.modelIds.push(id)
    return
  }
  form.modelIds.splice(index, 1)
}

/** Client-facing id for a route attachment, e.g. `cursor/halogen/gpt-4o`. */
function publicModelId(model: CatalogueModel) {
  const slug = form.slug.trim()
  return slug ? `${slug}/${model.id}` : model.id
}

/** Click-through toast; only the close control receives pointer events.
 * The Toaster merges its own `base` slot (`pointer-events-auto`) onto the same
 * element as the toast `root`, so the plain utility loses the merge. The
 * Tailwind v4 important modifier (`!`) is required to win. */
const copyToastUi = {
  root: 'pointer-events-none!',
  close: 'pointer-events-auto!',
}

async function copyModelId(model: CatalogueModel) {
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

function onNameBlur() {
  if (!form.slug.trim() && form.name.trim()) {
    form.slug = form.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64)
  }
}

async function save() {
  if (!canSave.value) {
    return
  }
  saving.value = true
  try {
    const body = {
      name: form.name.trim(),
      slug: form.slug.trim(),
      modelIds: [...form.modelIds],
    }
    if (props.route) {
      await $fetch(`/api/router/${props.route.id}`, { method: 'PUT', body })
      toast.add({ title: 'Route updated', color: 'success' })
    }
    else {
      await $fetch('/api/router', { method: 'POST', body })
      toast.add({ title: 'Route created', color: 'success' })
    }
    open.value = false
    emit('saved')
  }
  catch (err: unknown) {
    toast.add({
      title: 'Could not save route',
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
  <UDrawer
    v-model:open="open"
    direction="right"
    :handle="false"
    :title="title"
    description="Public ids become {slug}/{provider}/{model}. Only pick models to attach."
    :ui="{ content: 'sm:max-w-lg' }"
  >
    <template #body>
      <form
        class="space-y-5"
        @submit.prevent="save"
      >
        <UFormField
          label="Name"
          required
        >
          <UInput
            v-model="form.name"
            placeholder="Cursor"
            class="w-full"
            @blur="onNameBlur"
          />
        </UFormField>

        <UFormField
          label="Route slug"
          required
          hint="Prefix for public model ids, e.g. cursor → cursor/halogen/…"
        >
          <UInput
            v-model="form.slug"
            placeholder="cursor"
            class="w-full font-mono"
          />
        </UFormField>

        <div class="space-y-3">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-baseline gap-2">
              <p class="text-sm font-medium text-highlighted">
                Models
              </p>
              <p class="text-xs text-muted">
                {{ form.modelIds.length }} selected
              </p>
            </div>
            <UButton
              :label="modelView === 'operational' ? 'Operational' : 'View'"
              :icon="modelView === 'operational' ? 'i-lucide-sliders-horizontal' : 'i-lucide-eye'"
              color="neutral"
              variant="soft"
              size="xs"
              @click="toggleModelView"
            />
          </div>

          <template v-if="modelView === 'operational'">
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

            <p
              v-if="loadingCatalogue"
              class="text-sm text-muted"
            >
              Loading models…
            </p>

            <ul
              v-else-if="filteredCatalogue.length"
              class="router-route-drawer__model-list max-h-[50vh] overflow-y-auto rounded-md border border-default divide-y divide-default"
            >
              <li
                v-for="model in filteredCatalogue"
                :key="model.id"
                class="router-route-drawer__model-item"
              >
                <button
                  type="button"
                  class="router-route-drawer__model-row hover:bg-elevated/50"
                  :title="`${model.providerName} · ${model.enabled ? 'enabled' : 'disabled'}`"
                  @click="toggleModel(model.id)"
                >
                  <UCheckbox
                    :model-value="selectedSet.has(model.id)"
                    tabindex="-1"
                    class="router-route-drawer__model-check pointer-events-none"
                  />
                  <span class="router-route-drawer__model-title text-highlighted">
                    {{ model.id }}
                  </span>
                  <UIcon
                    :name="model.enabled ? 'i-lucide-circle-check' : 'i-lucide-circle-off'"
                    class="router-route-drawer__model-status"
                    :class="model.enabled
                      ? 'router-route-drawer__model-status--enabled text-success'
                      : 'router-route-drawer__model-status--disabled text-muted'"
                    :aria-label="model.enabled ? 'Enabled' : 'Disabled'"
                  />
                </button>
              </li>
            </ul>

            <p
              v-else
              class="text-sm text-muted"
            >
              No models match this filter.
            </p>
          </template>

          <template v-else>
            <p
              v-if="loadingCatalogue"
              class="text-sm text-muted"
            >
              Loading models…
            </p>

            <ul
              v-else-if="viewModels.length"
              class="router-route-drawer__model-list max-h-[50vh] overflow-y-auto rounded-md border border-default divide-y divide-default"
            >
              <li
                v-for="model in viewModels"
                :key="model.id"
                class="router-route-drawer__model-item"
              >
                <div class="router-route-drawer__model-row">
                  <span class="router-route-drawer__model-title text-highlighted">
                    {{ model.id }}
                  </span>
                  <span class="shrink-0 text-xs text-muted">
                    {{ model.providerName }}
                  </span>
                  <UButton
                    icon="i-lucide-copy"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    class="shrink-0"
                    :aria-label="`Copy ${publicModelId(model)}`"
                    @click="copyModelId(model)"
                  />
                </div>
              </li>
            </ul>

            <p
              v-else
              class="text-sm text-muted"
            >
              {{ form.modelIds.length
                ? 'Selected models are all disabled on their provider.'
                : 'No models selected yet. Switch to Operational to attach some.' }}
            </p>
          </template>
        </div>

        <div class="flex justify-end gap-2 pt-1">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            :disabled="saving"
            @click="open = false"
          />
          <UButton
            type="submit"
            :label="isEdit ? 'Save' : 'Create'"
            icon="i-lucide-save"
            :loading="saving"
            :disabled="!canSave"
          />
        </div>
      </form>
    </template>
  </UDrawer>
</template>

<style scoped>
.router-route-drawer__model-row {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: flex-start;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  text-align: left;
}

.router-route-drawer__model-title {
  flex: 1 1 0%;
  min-width: 0;
  text-align: left;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.875rem;
  line-height: 1.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.router-route-drawer__model-status {
  flex-shrink: 0;
  width: 1rem;
  height: 1rem;
}
</style>
