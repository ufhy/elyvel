<script setup lang="ts">
import { LayoutGrid } from '@lucide/vue'

defineProps<{ title: string, subtitle?: string }>()
</script>

<template>
  <div class="grid min-h-screen lg:grid-cols-2">
    <!-- Brand panel -->
    <div class="relative hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
      <div class="flex items-center gap-2">
        <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-foreground/10">
          <LayoutGrid class="h-4 w-4" />
        </div>
        <span class="font-semibold">Elyvel</span>
      </div>
      <blockquote class="space-y-2">
        <p class="text-lg">
          Ship a full-stack app in minutes — auth, SSR, and a clean UI, batteries included.
        </p>
        <footer class="text-sm text-primary-foreground/70">
          The Elysia-first, Laravel-inspired framework.
        </footer>
      </blockquote>
    </div>
    <!-- Form panel -->
    <div class="flex items-center justify-center bg-background px-4 py-12">
      <div class="w-full max-w-sm">
        <div class="mb-6 flex justify-center lg:hidden">
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <LayoutGrid class="h-5 w-5" />
          </div>
        </div>
        <div class="mb-6">
          <h1 class="text-xl font-semibold text-foreground">
            {{ title }}
          </h1>
          <p v-if="subtitle" class="mt-1 text-sm text-muted-foreground">
            {{ subtitle }}
          </p>
        </div>
        <slot />
      </div>
    </div>
  </div>
</template>
