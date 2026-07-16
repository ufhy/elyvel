<script setup lang="ts">
defineProps<{ title: string, subtitle?: string }>()
</script>

<template>
  <div class="grid min-h-screen lg:grid-cols-2">
    <!-- Brand panel -->
    <div class="relative hidden flex-col justify-between bg-indigo-600 p-10 text-white lg:flex">
      <div class="flex items-center gap-2">
        <div class="h-8 w-8 rounded-lg bg-white/20" />
        <span class="font-semibold">Ravel</span>
      </div>
      <blockquote class="space-y-2">
        <p class="text-lg">
          Ship a full-stack app in minutes — auth, SSR, and a clean UI, batteries included.
        </p>
        <footer class="text-sm text-indigo-200">
          The Elysia-first, Laravel-inspired framework.
        </footer>
      </blockquote>
    </div>
    <!-- Form panel -->
    <div class="flex items-center justify-center bg-gray-50 px-4 py-12 dark:bg-gray-950">
      <div class="w-full max-w-sm">
        <div class="mb-6 text-center lg:hidden">
          <div class="mx-auto mb-3 h-10 w-10 rounded-xl bg-indigo-600" />
        </div>
        <div class="mb-6">
          <h1 class="text-xl font-bold text-gray-900 dark:text-white">
            {{ title }}
          </h1>
          <p v-if="subtitle" class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {{ subtitle }}
          </p>
        </div>
        <slot />
      </div>
    </div>
  </div>
</template>
