<script setup lang="ts">
import { Link, router, usePage } from '@inertiajs/vue3'
import ThemeToggle from '../../components/ThemeToggle.vue'
import { authApi } from '../../lib/auth'

const page = usePage()
const user = () => (page.props as { user?: { name?: string, email?: string } }).user
const currentPath = () => (page.props as { url?: string }).url ?? (typeof window !== 'undefined' ? window.location.pathname : '')

async function logout() {
  await authApi.signOut()
  router.visit('/login')
}

const nav = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/settings/profile', label: 'Settings' },
]

function isActive(href: string): boolean {
  const path = currentPath()
  return href === '/settings/profile' ? path.startsWith('/settings') : path === href
}
</script>

<template>
  <div class="flex min-h-screen bg-gray-50 dark:bg-gray-950">
    <aside class="flex w-60 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div class="flex items-center gap-2 px-5 py-4">
        <div class="h-7 w-7 rounded-lg bg-indigo-600" />
        <span class="text-sm font-semibold text-gray-900 dark:text-white">Ravel</span>
      </div>
      <nav class="flex flex-1 flex-col gap-1 px-3 py-2">
        <Link
          v-for="item in nav"
          :key="item.href"
          :href="item.href"
          class="rounded-lg px-3 py-2 text-sm font-medium" :class="[
            isActive(item.href)
              ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800/60 dark:hover:text-white',
          ]"
        >
          {{ item.label }}
        </Link>
      </nav>
      <div class="border-t border-gray-200 px-3 py-3 dark:border-gray-800">
        <div class="flex items-center justify-between">
          <span class="truncate text-sm text-gray-500 dark:text-gray-400" data-testid="nav-user">{{ user()?.email }}</span>
          <ThemeToggle />
        </div>
        <button
          class="mt-2 w-full rounded-lg px-3 py-1.5 text-left text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          data-testid="logout"
          @click="logout"
        >
          Log out
        </button>
      </div>
    </aside>
    <main class="mx-auto w-full max-w-4xl px-6 py-8">
      <slot />
    </main>
  </div>
</template>
