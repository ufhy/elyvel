<script setup lang="ts">
import { Link, router, usePage } from '@inertiajs/vue3'
import { authApi } from '../lib/auth'

const page = usePage()
const user = () => (page.props as { user?: { name?: string, email?: string } }).user

async function logout() {
  await authApi.signOut()
  router.visit('/login')
}

const nav = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/settings/profile', label: 'Profile' },
  { href: '/settings/password', label: 'Password' },
  { href: '/settings/two-factor', label: 'Two-Factor' },
]
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-950">
    <header class="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div class="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
        <div class="flex items-center gap-6">
          <div class="h-7 w-7 rounded-lg bg-indigo-600" />
          <nav class="flex gap-4">
            <Link
              v-for="item in nav"
              :key="item.href"
              :href="item.href"
              class="text-sm font-medium text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
            >
              {{ item.label }}
            </Link>
          </nav>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-sm text-gray-500 dark:text-gray-400" data-testid="nav-user">{{ user()?.email }}</span>
          <button
            class="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            data-testid="logout"
            @click="logout"
          >
            Log out
          </button>
        </div>
      </div>
    </header>
    <main class="mx-auto max-w-4xl px-4 py-8">
      <slot />
    </main>
  </div>
</template>
