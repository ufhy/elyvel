<script setup lang="ts">
import { authApi } from '../lib/auth'

const props = defineProps<{ providers?: string[] }>()

const labels: Record<string, string> = { github: 'GitHub', google: 'Google' }

async function signIn(provider: string): Promise<void> {
  const { data } = await authApi.signInSocial(provider)
  const url = (data as { url?: string } | undefined)?.url
  if (url)
    window.location.href = url
}
</script>

<template>
  <div v-if="props.providers && props.providers.length" class="space-y-2">
    <div class="relative my-5 flex items-center gap-3">
      <span class="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
      <span class="text-xs text-gray-400">or continue with</span>
      <span class="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
    </div>
    <button
      v-for="p in props.providers"
      :key="p"
      type="button"
      class="flex w-full items-center justify-center rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
      :data-testid="`social-${p}`"
      @click="signIn(p)"
    >
      Continue with {{ labels[p] ?? p }}
    </button>
  </div>
</template>
