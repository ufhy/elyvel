<script setup lang="ts">
import type { Appearance } from '@/composables/useAppearance'
import { Monitor, Moon, Sun } from '@lucide/vue'
import { useAppearance } from '@/composables/useAppearance'

const { appearance, updateAppearance } = useAppearance()

const tabs = [
  { value: 'light', Icon: Sun, label: 'Light' },
  { value: 'dark', Icon: Moon, label: 'Dark' },
  { value: 'system', Icon: Monitor, label: 'System' },
] as const satisfies { value: Appearance, Icon: unknown, label: string }[]
</script>

<template>
  <div class="inline-flex gap-1 rounded-lg bg-muted p-1">
    <button
      v-for="{ value, Icon, label } in tabs"
      :key="value"
      type="button"
      :data-testid="`appearance-${value}`"
      class="flex items-center rounded-md px-3.5 py-1.5 transition-colors" :class="[
        appearance === value
          ? 'bg-background text-foreground shadow-xs'
          : 'text-muted-foreground hover:text-foreground',
      ]"
      @click="updateAppearance(value)"
    >
      <component :is="Icon" class="-ml-1 h-4 w-4" />
      <span class="ml-1.5 text-sm">{{ label }}</span>
    </button>
  </div>
</template>
