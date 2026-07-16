<script setup lang="ts">
import type { BreadcrumbItem } from '@/types'
import PlaceholderPattern from '@/components/PlaceholderPattern.vue'
import AppLayout from '@/Layouts/AppLayout.vue'

const breadcrumbs: BreadcrumbItem[] = [{ title: 'Dashboard', href: '/dashboard' }]
</script>

<template>
  <AppLayout :breadcrumbs="breadcrumbs">
    <div class="flex h-full flex-1 flex-col gap-4 overflow-x-auto rounded-xl p-4">
      <div class="grid auto-rows-min gap-4 md:grid-cols-3">
        <div
          v-for="i in 3"
          :key="i"
          class="relative aspect-video overflow-hidden rounded-xl border border-sidebar-border/70 dark:border-sidebar-border"
        >
          <PlaceholderPattern />
        </div>
      </div>
      <div
        class="relative min-h-screen flex-1 overflow-hidden rounded-xl border border-sidebar-border/70 md:min-h-min dark:border-sidebar-border"
        data-testid="dashboard-heading"
      >
        <PlaceholderPattern />
      </div>
    </div>
  </AppLayout>
</template>
