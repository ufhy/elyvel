<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import AuthLayout from '@/Layouts/AuthLayout.vue'
import { authApi } from '@/lib/auth'

const router = useRouter()
const token = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)

onMounted(() => {
  token.value = new URLSearchParams(window.location.search).get('token') ?? ''
})

async function submit() {
  error.value = ''
  busy.value = true
  const { error: err } = await authApi.resetPassword(password.value, token.value)
  busy.value = false
  if (err) {
    error.value = err
    return
  }
  router.push('/login')
}
</script>

<template>
  <AuthLayout title="Reset password" subtitle="Choose a new password">
    <form class="space-y-4" @submit.prevent="submit">
      <Alert v-if="error" variant="destructive" data-testid="error">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
      <Alert v-if="!token" variant="destructive" data-testid="no-token">
        <AlertDescription>Missing or invalid reset token.</AlertDescription>
      </Alert>
      <div class="grid gap-2">
        <Label for="password">New password</Label>
        <Input id="password" v-model="password" type="password" autocomplete="new-password" required />
      </div>
      <Button type="submit" class="w-full" :disabled="busy || !token" data-testid="submit">
        {{ busy ? 'Saving…' : 'Reset password' }}
      </Button>
    </form>
    <p class="mt-5 text-center text-sm text-muted-foreground">
      <RouterLink to="/login" class="font-medium text-foreground hover:underline">
        Back to sign in
      </RouterLink>
    </p>
  </AuthLayout>
</template>
