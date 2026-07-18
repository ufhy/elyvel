<script setup lang="ts">
import type { HTMLAttributes } from 'vue'

defineOptions({
  inheritAttrs: false,
})

defineProps<Props>()

interface Props {
  className?: HTMLAttributes['class']
}
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 48 48"
    :class="className"
    v-bind="$attrs"
  >
    <circle cx="24" cy="24" r="13" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-dasharray="63 19" transform="rotate(28 24 24)" />
    <rect x="15" y="21.5" width="18" height="5" rx="2.5" fill="currentColor" />
  </svg>
</template>
