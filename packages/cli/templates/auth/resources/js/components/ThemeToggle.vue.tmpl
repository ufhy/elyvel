<script setup lang="ts">
import type { Appearance } from '../composables/useAppearance'
import { computed } from 'vue'
import { useAppearance } from '../composables/useAppearance'

const { appearance, updateAppearance } = useAppearance()

const order: Appearance[] = ['light', 'dark', 'system']
const icons: Record<Appearance, string> = {
  light: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.36 6.36-.7-.7M6.34 6.34l-.7-.7m12.72 0-.7.7M6.34 17.66l-.7.7M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  dark: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z',
  system: 'M3 5h18v11H3zM8 21h8m-4-5v5',
}
const path = computed(() => icons[appearance.value])

function cycle(): void {
  const next = order[(order.indexOf(appearance.value) + 1) % order.length]
  updateAppearance(next!)
}
</script>

<template>
  <button
    type="button"
    :title="`Theme: ${appearance}`"
    data-testid="theme-toggle"
    class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
    @click="cycle"
  >
    <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path :d="path" />
    </svg>
    <span class="sr-only">Toggle theme</span>
  </button>
</template>
