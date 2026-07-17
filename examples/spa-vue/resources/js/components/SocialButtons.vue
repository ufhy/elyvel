<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { authApi } from '@/lib/auth'

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
      <span class="h-px flex-1 bg-border" />
      <span class="text-xs text-muted-foreground">or continue with</span>
      <span class="h-px flex-1 bg-border" />
    </div>
    <Button
      v-for="p in props.providers"
      :key="p"
      variant="outline"
      class="w-full"
      :data-testid="`social-${p}`"
      @click="signIn(p)"
    >
      Continue with {{ labels[p] ?? p }}
    </Button>
  </div>
</template>
