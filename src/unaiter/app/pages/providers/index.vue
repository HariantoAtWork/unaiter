<script setup lang="ts">
import type { ProviderAdapterPublic, ProviderPublic } from '~/types/providers'
import { providerKeyMethodLabel } from '~/types/providers'
import { apiErrorMessage } from '~/utils/apiError'

const DEFAULT_ADAPTER_ID = 'default'

type ModalMode = 'create' | 'edit'

const route = useRoute()
const toast = useToast()
const confirm = useConfirmDialog()
const deleting = ref(false)
const open = ref(false)
const keysDrawerOpen = ref(false)
const keysDrawerProviderId = ref<string | null>(null)
const modelsDrawerOpen = ref(false)
const modelsDrawerProviderId = ref<string | null>(null)
const chatModalOpen = ref(false)
const chatProviderId = ref<string | null>(null)
const mode = ref<ModalMode>('create')
const editingId = ref<string | null>(null)

type ImportProvider = {
  name: string
  slug: string
  baseUrl: string
  keyMethod?: string
  keys?: unknown[]
  models?: unknown[]
}

const fileInputRef = ref<HTMLInputElement | null>(null)
const importModalOpen = ref(false)
const importItems = ref<ImportProvider[]>([])

async function exportProviders() {
  try {
    const data = await $fetch('/api/providers/export')
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `unaiter-providers-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    toast.add({ title: 'Providers exported', color: 'success' })
  }
  catch (err: unknown) {
    toast.add({
      title: 'Export failed',
      description: apiErrorMessage(err),
      color: 'error',
    })
  }
}

async function onImportFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) {
    return
  }

  try {
    const parsed = JSON.parse(await file.text())
    const result = await $fetch<{ providers: ImportProvider[] }>(
      '/api/providers/import.parse',
      { method: 'POST', body: parsed },
    )
    importItems.value = result.providers
    importModalOpen.value = true
  }
  catch (err: unknown) {
    toast.add({
      title: 'Could not read providers file',
      description: err instanceof SyntaxError ? 'The file is not valid JSON.' : apiErrorMessage(err),
      color: 'error',
    })
  }
}

const settingsItems = [[
  {
    label: 'Import',
    icon: 'i-lucide-upload',
    onSelect: () => fileInputRef.value?.click(),
  },
  {
    label: 'Export',
    icon: 'i-lucide-download',
    onSelect: () => exportProviders(),
  },
]]

const { data, refresh } = await useFetch<{ providers: ProviderPublic[] }>('/api/providers')

const { data: adapterCatalogue } = useAsyncData(
  'provider-adapters',
  () => $fetch<ProviderAdapterPublic[]>('/api/provider-adapters'),
  // Auth cookie is client-only; SSR would 401 and cache an empty list.
  { server: false, default: () => [] },
)

function adapterLabel(adapterId: string | undefined) {
  if (!adapterId || adapterId === DEFAULT_ADAPTER_ID) {
    return null
  }
  const known = adapterCatalogue.value?.find(adapter => adapter.id === adapterId)
  return known ? known.label : adapterId
}

const isEmpty = computed(() => !data.value?.providers?.length)
const editingProvider = computed(() =>
  data.value?.providers?.find(provider => provider.id === editingId.value) || null,
)
const keysDrawerProvider = computed(() =>
  data.value?.providers?.find(provider => provider.id === keysDrawerProviderId.value) || null,
)
const modelsDrawerProvider = computed(() =>
  data.value?.providers?.find(provider => provider.id === modelsDrawerProviderId.value) || null,
)
const chatProvider = computed(() =>
  data.value?.providers?.find(provider => provider.id === chatProviderId.value) || null,
)

useHead({ title: 'Providers · Una Iter' })

function queryProviderId(key: 'keys' | 'models') {
  const value = route.query[key]
  return typeof value === 'string' && value ? value : null
}

function providerExists(id: string | null) {
  if (!id) {
    return false
  }
  return !!data.value?.providers?.some(provider => provider.id === id)
}

async function setDrawerQuery(patch: { keys?: string | null, models?: string | null }) {
  const query = { ...route.query }
  for (const key of ['keys', 'models'] as const) {
    if (!(key in patch)) {
      continue
    }
    const value = patch[key]
    if (value) {
      query[key] = value
    }
    else {
      delete query[key]
    }
  }
  await navigateTo({ query }, { replace: true })
}

function openKeysDrawer(provider: ProviderPublic) {
  keysDrawerProviderId.value = provider.id
  keysDrawerOpen.value = true
  void setDrawerQuery({ keys: provider.id })
}

function openModelsDrawer(provider: ProviderPublic) {
  modelsDrawerProviderId.value = provider.id
  modelsDrawerOpen.value = true
  void setDrawerQuery({ models: provider.id })
}

function openChat(provider: ProviderPublic) {
  chatProviderId.value = provider.id
  chatModalOpen.value = true
}

function providerActionItems(provider: ProviderPublic) {
  return [[
    {
      label: 'Chat',
      icon: 'i-lucide-message-square',
      onSelect: () => openChat(provider),
    },
    {
      label: 'Edit',
      icon: 'i-lucide-pencil',
      onSelect: () => openEdit(provider),
    },
    {
      label: 'Delete',
      icon: 'i-lucide-trash-2',
      color: 'error',
      onSelect: () => confirmDeleteProvider(provider),
    },
  ]]
}

watch(keysDrawerOpen, (value) => {
  if (!value) {
    keysDrawerProviderId.value = null
    if (queryProviderId('keys')) {
      void setDrawerQuery({ keys: null })
    }
  }
})

watch(modelsDrawerOpen, (value) => {
  if (!value) {
    modelsDrawerProviderId.value = null
    if (queryProviderId('models')) {
      void setDrawerQuery({ models: null })
    }
  }
})

const keysFromQuery = queryProviderId('keys')
if (providerExists(keysFromQuery)) {
  keysDrawerProviderId.value = keysFromQuery
  keysDrawerOpen.value = true
}

const modelsFromQuery = queryProviderId('models')
if (providerExists(modelsFromQuery)) {
  modelsDrawerProviderId.value = modelsFromQuery
  modelsDrawerOpen.value = true
}

function openCreate() {
  mode.value = 'create'
  editingId.value = null
  open.value = true
}

function openEdit(provider: ProviderPublic) {
  mode.value = 'edit'
  editingId.value = provider.id
  open.value = true
}

if (isEmpty.value) {
  openCreate()
}

async function confirmDeleteProvider(provider: ProviderPublic) {
  const ok = await confirm({
    title: 'Delete provider?',
    description: `Remove “${provider.name}” and all of its API keys. This cannot be undone.`,
    confirmLabel: 'Delete',
    confirmColor: 'error',
  })
  if (!ok) {
    return
  }

  deleting.value = true
  try {
    await $fetch(`/api/providers/${provider.id}`, { method: 'DELETE' })
    toast.add({ title: 'Provider deleted', color: 'success' })
    if (editingId.value === provider.id) {
      open.value = false
      editingId.value = null
    }
    if (keysDrawerProviderId.value === provider.id) {
      keysDrawerOpen.value = false
    }
    if (modelsDrawerProviderId.value === provider.id) {
      modelsDrawerOpen.value = false
    }
    await refresh()
  }
  catch (err: unknown) {
    toast.add({
      title: 'Could not delete provider',
      description: apiErrorMessage(err),
      color: 'error',
    })
  }
  finally {
    deleting.value = false
  }
}

async function removeKey(provider: ProviderPublic, keyId: string) {
  const ok = await confirm({
    title: 'Remove API key?',
    description: 'This key will be removed from the provider. This cannot be undone.',
    confirmLabel: 'Remove',
    confirmColor: 'error',
  })
  if (!ok) {
    return
  }

  try {
    await $fetch(`/api/providers/${provider.id}/keys/${keyId}`, { method: 'DELETE' })
    toast.add({ title: 'API key removed', color: 'success' })
    await refresh()
  }
  catch (err: unknown) {
    toast.add({
      title: 'Could not remove key',
      description: apiErrorMessage(err),
      color: 'error',
    })
  }
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="Providers">
        <template #right>
          <UButton
            label="Add provider"
            icon="i-lucide-plus"
            @click="openCreate"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-6 max-w-3xl">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h1 class="text-xl font-semibold text-highlighted">
              Providers
            </h1>
            <p class="text-sm text-muted mt-1">
              Create, edit, and delete OpenAI-compatible providers, keys, and models.
            </p>
          </div>
          <UDropdownMenu :items="settingsItems">
            <UButton
              icon="i-lucide-settings"
              color="neutral"
              variant="ghost"
              aria-label="Provider settings"
            />
          </UDropdownMenu>
        </div>

        <input
          ref="fileInputRef"
          type="file"
          accept="application/json,.json"
          class="hidden"
          @change="onImportFileChange"
        >

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <h2 class="font-semibold text-highlighted">
                Saved providers
              </h2>
              <UButton
                v-if="isEmpty"
                label="Add provider"
                icon="i-lucide-plus"
                size="sm"
                variant="soft"
                @click="openCreate"
              />
            </div>
          </template>

          <div
            v-if="isEmpty"
            class="text-sm text-muted"
          >
            No providers yet. Add one to get started, or close the dialog to browse this empty list.
          </div>

          <ul
            v-else
            class="divide-y divide-default"
          >
            <li
              v-for="provider in data?.providers"
              :key="provider.id"
              class="py-4"
            >
              <div class="flex items-start justify-between gap-4">
                <div class="min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <p class="font-medium text-highlighted">
                      {{ provider.name }}
                    </p>
                    <UBadge
                      color="neutral"
                      variant="subtle"
                    >
                      {{ providerKeyMethodLabel(provider.keyMethod) }}
                    </UBadge>
                    <UBadge
                      v-if="adapterLabel(provider.adapterId)"
                      color="info"
                      variant="subtle"
                      icon="i-lucide-plug"
                    >
                      {{ adapterLabel(provider.adapterId) }}
                    </UBadge>
                  </div>
                  <p class="text-sm text-muted">
                    {{ provider.slug }} · {{ provider.baseUrl }}
                  </p>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <UButton
                    :label="`${provider.keyCount} keys`"
                    color="neutral"
                    variant="soft"
                    size="sm"
                    trailing-icon="i-lucide-panel-right"
                    @click="openKeysDrawer(provider)"
                  />
                  <UButton
                    color="neutral"
                    variant="soft"
                    size="sm"
                    trailing-icon="i-lucide-panel-right"
                    @click="openModelsDrawer(provider)"
                  >
                    <span><span class="text-success">{{ provider.enabledModelCount ?? 0 }}</span>/{{ provider.modelCount ?? 0 }} models</span>
                  </UButton>
                  <UDropdownMenu :items="providerActionItems(provider)">
                    <UButton
                      icon="i-lucide-ellipsis"
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      aria-label="Provider actions"
                    />
                  </UDropdownMenu>
                </div>
              </div>
            </li>
          </ul>
        </UCard>

        <ProvidersProviderKeysDrawer
          v-model:open="keysDrawerOpen"
          :provider="keysDrawerProvider"
          @refreshed="refresh()"
        />

        <ProvidersProviderModelsDrawer
          v-model:open="modelsDrawerOpen"
          :provider="modelsDrawerProvider"
          @refreshed="refresh()"
        />

        <ProvidersProviderChatModal
          v-model:open="chatModalOpen"
          :provider="chatProvider"
          @update:open="(value) => { if (!value) chatProviderId = null }"
        />

        <ProvidersProviderFormModal
          v-model:open="open"
          :mode="mode"
          :editing-provider="editingProvider"
          @saved="refresh()"
          @remove-key="removeKey"
        />

        <ProvidersProviderImportModal
          v-model:open="importModalOpen"
          :items="importItems"
          @done="refresh()"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
