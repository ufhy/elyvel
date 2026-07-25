<script setup lang="ts">
import { Link, router } from '@inertiajs/vue3'
import { ref } from 'vue'
import SocialButtons from '@/components/SocialButtons.vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import AuthLayout from '@/Layouts/AuthLayout.vue'
import { authApi } from '@/lib/auth'

defineProps<{ socialProviders?: string[] }>()

const email = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)

async function submit(): Promise<void> {
  error.value = ''
  busy.value = true
  const { data, error: err } = await authApi.signIn(email.value, password.value)
  busy.value = false
  if (err) {
    error.value = err
    return
  }
  // 2FA-enabled accounts return a challenge instead of a full session.
  if ((data as { twoFactorRedirect?: boolean } | undefined)?.twoFactorRedirect) {
    router.visit('/two-factor')
    return
  }
  router.visit('/dashboard')
}
</script>

<template>
  <AuthLayout title="Welcome back" subtitle="Sign in to your account">
    <form class="space-y-4" @submit.prevent="submit">
      <Alert v-if="error" variant="destructive" data-testid="error">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
      <div class="grid gap-2">
        <Label for="email">Email</Label>
        <Input id="email" v-model="email" type="email" autocomplete="email" required />
      </div>
      <div class="grid gap-2">
        <div class="flex items-center justify-between">
          <Label for="password">Password</Label>
          <Link href="/forgot-password" class="text-sm text-muted-foreground hover:text-foreground">
            Forgot password?
          </Link>
        </div>
        <Input id="password" v-model="password" type="password" autocomplete="current-password" required />
      </div>
      <Button type="submit" class="w-full" :disabled="busy" data-testid="submit">
        {{ busy ? 'Signing in…' : 'Sign in' }}
      </Button>
    </form>
    <SocialButtons :providers="socialProviders" />
    <p class="mt-5 text-center text-sm text-muted-foreground">
      No account?
      <Link href="/register" class="font-medium text-foreground hover:underline">
        Create one
      </Link>
    </p>
  </AuthLayout>
</template>
