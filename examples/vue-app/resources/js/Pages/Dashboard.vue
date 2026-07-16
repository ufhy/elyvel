<script setup lang="ts">
import { usePage } from '@inertiajs/vue3'
import AppLayout from '../Layouts/AppLayout.vue'

const page = usePage()
const user = () => (page.props as { user?: { name?: string, email?: string } }).user
</script>

<template>
  <AppLayout>
    <h1 class="text-2xl font-bold text-gray-900 dark:text-white" data-testid="dashboard-heading">
      Welcome back, {{ user()?.name }}
    </h1>
    <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
      Here's what's happening in your app.
    </p>
    <div class="mt-6 grid gap-4 sm:grid-cols-3">
      <div
        v-for="stat in [
          { label: 'Signed in as', value: user()?.email },
          { label: 'Plan', value: 'Free' },
          { label: 'Status', value: 'Active' },
        ]"
        :key="stat.label"
        class="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900"
      >
        <p class="text-xs font-medium uppercase tracking-wide text-gray-400">
          {{ stat.label }}
        </p>
        <p class="mt-1 truncate text-lg font-semibold text-gray-900 dark:text-white">
          {{ stat.value }}
        </p>
      </div>
    </div>
  </AppLayout>
</template>
