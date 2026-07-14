<script setup lang="ts">
defineProps<{ tone?: 'error' | 'success' }>()
</script>

<template>
  <div
    v-if="$slots.default"
    :class="[
      'rounded-lg px-3 py-2 text-sm',
      (tone ?? 'error') === 'error'
        ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
        : 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300',
    ]"
    role="alert"
  >
    <slot />
  </div>
</template>
