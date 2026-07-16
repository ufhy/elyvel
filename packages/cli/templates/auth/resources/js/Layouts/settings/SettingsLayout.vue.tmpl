<script setup lang="ts">
import { Link, usePage } from '@inertiajs/vue3'
import AppLayout from '../AppLayout.vue'

const page = usePage()
const currentPath = () => (page.props as { url?: string }).url ?? (typeof window !== 'undefined' ? window.location.pathname : '')

const items = [
  { href: '/settings/profile', label: 'Profile' },
  { href: '/settings/password', label: 'Password' },
  { href: '/settings/two-factor', label: 'Two-Factor' },
  { href: '/settings/appearance', label: 'Appearance' },
]
</script>

<template>
  <AppLayout>
    <div class="mb-6">
      <h1 class="text-xl font-bold text-gray-900 dark:text-white">
        Settings
      </h1>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        Manage your account settings and preferences.
      </p>
    </div>
    <div class="flex flex-col gap-8 lg:flex-row">
      <nav class="flex gap-1 lg:w-48 lg:flex-col">
        <Link
          v-for="item in items"
          :key="item.href"
          :href="item.href"
          class="rounded-lg px-3 py-2 text-sm font-medium" :class="[
            currentPath() === item.href
              ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800/60 dark:hover:text-white',
          ]"
        >
          {{ item.label }}
        </Link>
      </nav>
      <div class="flex-1">
        <slot />
      </div>
    </div>
  </AppLayout>
</template>
