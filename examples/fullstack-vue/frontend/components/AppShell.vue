<script setup lang="ts">
import type { AppVariant } from '@/types'
import { SidebarProvider } from '@/components/ui/sidebar'

withDefaults(defineProps<{ variant?: AppVariant }>(), {
  variant: 'sidebar',
})
</script>

<template>
  <div v-if="variant === 'header'" class="flex min-h-screen w-full flex-col">
    <slot />
  </div>
  <SidebarProvider v-else :default-open="true">
    <slot />
  </SidebarProvider>
</template>
