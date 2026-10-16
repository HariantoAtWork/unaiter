<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const route = useRoute()
const { user, logout } = useAuth()
const toast = useToast()

const items = computed<NavigationMenuItem[]>(() => [
  {
    label: 'Home',
    icon: 'i-lucide-layout-dashboard',
    to: '/',
    active: route.path === '/',
  },
  {
    label: 'Providers',
    icon: 'i-lucide-boxes',
    to: '/providers',
    active: route.path.startsWith('/providers'),
  },
  {
    label: 'Router',
    icon: 'i-lucide-git-branch',
    to: '/router',
    active: route.path.startsWith('/router'),
  },
])

async function onLogout() {
  await logout()
  toast.add({ title: 'Signed out', color: 'neutral' })
  await navigateTo('/login')
}
</script>

<template>
  <UDashboardGroup unit="rem">
    <UDashboardSidebar
      collapsible
      resizable
      :ui="{ footer: 'border-t border-default' }"
    >
      <template #header="{ collapsed }">
        <div v-if="!collapsed" class="flex items-center gap-2 min-w-0 flex-1">
          <UIcon
            name="i-lucide-route"
            class="size-5 text-primary shrink-0"
          />
          <span class="font-semibold text-highlighted truncate">
            Una Iter
          </span>
        </div>
        <UDashboardSidebarCollapse :class="collapsed ? 'mx-auto' : 'ms-auto'" />
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu
          :collapsed="collapsed"
          :items="items"
          orientation="vertical"
        />
      </template>

      <template #footer="{ collapsed }">
        <div
          class="flex w-full items-center gap-2"
          :class="collapsed ? 'flex-col' : ''"
        >
          <div
            v-if="!collapsed"
            class="min-w-0 flex-1"
          >
            <p class="text-sm font-medium text-highlighted truncate">
              {{ user?.username }}
            </p>
            <p class="text-xs text-muted">
              Administrator
            </p>
          </div>
          <UButton
            icon="i-lucide-log-out"
            color="neutral"
            variant="ghost"
            :square="collapsed"
            :label="collapsed ? undefined : 'Sign out'"
            @click="onLogout"
          />
        </div>
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
