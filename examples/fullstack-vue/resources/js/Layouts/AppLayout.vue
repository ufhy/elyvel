<script setup lang="ts">
import type { BreadcrumbItem } from '@/types'
// Pick your application shell here. The sidebar layout is the default; swap the
// import to `./app/AppHeaderLayout.vue` for a top-nav layout instead.
import AppLayoutTemplate from './app/AppSidebarLayout.vue'

withDefaults(defineProps<{ breadcrumbs?: BreadcrumbItem[] }>(), {
  breadcrumbs: () => [],
})
</script>

<template>
  <AppLayoutTemplate :breadcrumbs="breadcrumbs">
    <slot />
  </AppLayoutTemplate>
</template>
