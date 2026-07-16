<script setup lang="ts">
import type { Appearance } from '@/composables/useAppearance'
import { Monitor, Moon, Sun } from '@lucide/vue'
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { useAppearance } from '@/composables/useAppearance'

const { appearance, updateAppearance } = useAppearance()

const order: Appearance[] = ['light', 'dark', 'system']
const icon = computed(() => ({ light: Sun, dark: Moon, system: Monitor })[appearance.value])

function cycle(): void {
  updateAppearance(order[(order.indexOf(appearance.value) + 1) % order.length]!)
}
</script>

<template>
  <Button variant="ghost" size="icon" :title="`Theme: ${appearance}`" data-testid="theme-toggle" @click="cycle">
    <component :is="icon" class="h-4 w-4" />
    <span class="sr-only">Toggle theme</span>
  </Button>
</template>
