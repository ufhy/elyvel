<script setup lang="ts">
// Pick your application shell here. The sidebar layout is the default; swap the
// import to `./app/AppHeaderLayout.vue` for a top-nav layout instead.
import AppLayoutTemplate from './app/AppSidebarLayout.vue'
</script>

<template>
  <AppLayoutTemplate>
    <slot />
  </AppLayoutTemplate>
</template>
