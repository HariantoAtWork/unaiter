<script setup lang="ts">
import type { CustomRoutePublic } from '#router-shared/types'
import { apiErrorMessage } from '~/utils/apiError'

useHead({ title: 'Router · Una Iter' })

/** Sentinel `?route=` value for the create drawer, which has no id yet. */
const NEW_ROUTE = 'new'

const toast = useToast()
const confirm = useConfirmDialog()
const currentRoute = useRoute()
const { data, refresh, status } = useCustomRoutes()

const drawerOpen = ref(false)
const editing = ref<CustomRoutePublic | null>(null)
const deleting = ref(false)

const routes = computed(() => data.value?.routes ?? [])
const isEmpty = computed(() => status.value !== 'pending' && routes.value.length === 0)

const routeParam = computed(() => {
  const value = currentRoute.query.route
  return typeof value === 'string' && value ? value : null
})

async function setRouteQuery(value: string | null) {
  const query = { ...currentRoute.query }
  if (value) {
    query.route = value
  }
  else {
    delete query.route
  }
  await navigateTo({ query }, { replace: true })
}

function openCreate() {
  editing.value = null
  drawerOpen.value = true
  void setRouteQuery(NEW_ROUTE)
}

function openEdit(route: CustomRoutePublic) {
  editing.value = route
  drawerOpen.value = true
  void setRouteQuery(route.id)
}

watch(drawerOpen, (value) => {
  if (!value) {
    editing.value = null
    if (routeParam.value) {
      void setRouteQuery(null)
    }
  }
})

// Restore the drawer from the URL once the list resolves, so a refresh keeps it open.
watch(
  [routes, status],
  ([list, fetchStatus]) => {
    if (fetchStatus === 'pending' || drawerOpen.value) {
      return
    }
    const id = routeParam.value
    if (!id) {
      return
    }
    if (id === NEW_ROUTE) {
      editing.value = null
      drawerOpen.value = true
      return
    }
    const found = list.find(item => item.id === id)
    if (found) {
      editing.value = found
      drawerOpen.value = true
    }
    else {
      // Stale id (route deleted elsewhere) — drop it instead of lying about the target.
      void setRouteQuery(null)
    }
  },
  { immediate: true },
)

async function confirmDelete(route: CustomRoutePublic) {
  const ok = await confirm({
    title: 'Delete route?',
    description: `Remove “${route.name}” (${route.slug}/…). Attached models are only unlinked from this route.`,
    confirmLabel: 'Delete',
    confirmColor: 'error',
  })
  if (!ok) {
    return
  }

  deleting.value = true
  try {
    await $fetch(`/api/router/${route.id}`, { method: 'DELETE' })
    toast.add({ title: 'Route deleted', color: 'success' })
    if (editing.value?.id === route.id) {
      drawerOpen.value = false
    }
    await refresh()
  }
  catch (err: unknown) {
    toast.add({
      title: 'Could not delete route',
      description: apiErrorMessage(err),
      color: 'error',
    })
  }
  finally {
    deleting.value = false
  }
}

function routeActionItems(route: CustomRoutePublic) {
  return [[
    {
      label: 'Edit',
      icon: 'i-lucide-pencil',
      onSelect: () => openEdit(route),
    },
    {
      label: 'Delete',
      icon: 'i-lucide-trash-2',
      color: 'error',
      onSelect: () => confirmDelete(route),
    },
  ]]
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="Router">
        <template #right>
          <UButton
            label="Add route"
            icon="i-lucide-plus"
            @click="openCreate"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-6 max-w-3xl">
        <div>
          <h1 class="text-xl font-semibold text-highlighted">
            Custom routes
          </h1>
          <p class="text-sm text-muted mt-1">
            Name a prefix and attach provider models. Clients call
            <code class="text-xs">{slug}/{provider}/{model}</code>
            — Unaiter strips the prefix and proxies to the underlying model.
            Enabled attachments appear on
            <code class="text-xs">GET /v1/models</code>.
          </p>
        </div>

        <div
          v-if="status === 'pending' && !data"
          class="text-sm text-muted"
        >
          Loading…
        </div>

        <UCard v-else>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <h2 class="font-semibold text-highlighted">
                Routes
              </h2>
              <UButton
                v-if="isEmpty"
                label="Add route"
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
            No custom routes yet. Add one to expose models under a named prefix.
          </div>

          <ul
            v-else
            class="divide-y divide-default"
          >
            <li
              v-for="route in routes"
              :key="route.id"
              class="py-4 flex items-start justify-between gap-4"
            >
              <div class="min-w-0">
                <p class="font-medium text-highlighted">
                  {{ route.name }}
                </p>
                <p class="text-sm text-muted font-mono truncate">
                  {{ route.slug }}/…
                </p>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <UButton
                  color="neutral"
                  variant="soft"
                  size="sm"
                  @click="openEdit(route)"
                >
                  <span>
                    <span class="text-success">{{ route.enabledModelCount }}</span>/{{ route.modelCount }} models
                  </span>
                </UButton>
                <UDropdownMenu :items="routeActionItems(route)">
                  <UButton
                    icon="i-lucide-ellipsis"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    aria-label="Route actions"
                    :disabled="deleting"
                  />
                </UDropdownMenu>
              </div>
            </li>
          </ul>
        </UCard>

        <p class="text-sm text-muted">
          Looking for the writing/code intent planner?
          <NuxtLink
            to="/auto"
            class="text-primary hover:underline"
          >
            Open Auto
          </NuxtLink>
        </p>

        <RouterRouteDrawer
          v-model:open="drawerOpen"
          :route="editing"
          @saved="refresh()"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
