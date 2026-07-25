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

const name = ref('')
const email = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
  error.value = ''
  busy.value = true
  const { error: err } = await authApi.signUp(name.value, email.value, password.value)
  busy.value = false
  if (err) {
    error.value = err
    return
  }
  await refresh()
  router.push('/dashboard')
}
</script>

<template>
  <AuthLayout title="Create your account" subtitle="Get started in seconds">
    <form class="space-y-4" @submit.prevent="submit">
      <Alert v-if="error" variant="destructive" data-testid="error">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
      <div class="grid gap-2">
        <Label for="name">Name</Label>
        <Input id="name" v-model="name" autocomplete="name" required />
      </div>
      <div class="grid gap-2">
        <Label for="email">Email</Label>
        <Input id="email" v-model="email" type="email" autocomplete="email" required />
      </div>
      <div class="grid gap-2">
        <Label for="password">Password</Label>
        <Input id="password" v-model="password" type="password" autocomplete="new-password" required />
      </div>
      <Button type="submit" class="w-full" :disabled="busy" data-testid="submit">
        {{ busy ? 'Creating…' : 'Create account' }}
      </Button>
    </form>
    <SocialButtons :providers="config.social" />
    <p class="mt-5 text-center text-sm text-muted-foreground">
      Already have an account?
      <RouterLink to="/login" class="font-medium text-foreground hover:underline">
        Sign in
      </RouterLink>
    </p>
  </AuthLayout>
</template>
