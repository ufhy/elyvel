<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import SocialButtons from '@/components/SocialButtons.vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAppConfig } from '@/composables/useAppConfig'
import { useAuth } from '@/composables/useAuth'
import AuthLayout from '@/Layouts/AuthLayout.vue'
import { authApi } from '@/lib/auth'

const router = useRouter()
const { config, load } = useAppConfig()
const { refresh } = useAuth()
onMounted(load)

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
    router.push('/two-factor')
    return
  }
  await refresh()
  router.push('/dashboard')
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
          <RouterLink to="/forgot-password" class="text-sm text-muted-foreground hover:text-foreground">
            Forgot password?
          </RouterLink>
        </div>
        <Input id="password" v-model="password" type="password" autocomplete="current-password" required />
      </div>
      <Button type="submit" class="w-full" :disabled="busy" data-testid="submit">
        {{ busy ? 'Signing in…' : 'Sign in' }}
      </Button>
    </form>
    <SocialButtons :providers="config.social" />
    <p class="mt-5 text-center text-sm text-muted-foreground">
      No account?
      <RouterLink to="/register" class="font-medium text-foreground hover:underline">
        Create one
      </RouterLink>
    </p>
  </AuthLayout>
</template>
