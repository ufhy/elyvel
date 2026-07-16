<script setup lang="ts">
import type { Appearance } from '../composables/useAppearance'
import { useAppearance } from '../composables/useAppearance'

const { appearance, updateAppearance } = useAppearance()

const tabs: { value: Appearance, label: string, path: string }[] = [
  // Sun
  { value: 'light', label: 'Light', path: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.36 6.36-.7-.7M6.34 6.34l-.7-.7m12.72 0-.7.7M6.34 17.66l-.7.7M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z' },
  // Moon
  { value: 'dark', label: 'Dark', path: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z' },
  // Monitor
  { value: 'system', label: 'System', path: 'M3 5h18v11H3zM8 21h8m-4-5v5' },
]
</script>

<template>
  <div class="inline-flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
    <button
      v-for="tab in tabs"
      :key="tab.value"
      type="button"
      :data-testid="`appearance-${tab.value}`"
      class="flex items-center rounded-md px-3.5 py-1.5 transition-colors" :class="[
        appearance === tab.value
          ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
          : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white',
      ]"
      @click="updateAppearance(tab.value)"
    >
      <svg class="-ml-1 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path :d="tab.path" />
      </svg>
      <span class="ml-1.5 text-sm">{{ tab.label }}</span>
    </button>
  </div>
</template>
