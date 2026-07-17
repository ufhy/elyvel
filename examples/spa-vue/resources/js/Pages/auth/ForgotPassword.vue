<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import AuthLayout from '@/Layouts/AuthLayout.vue'
import { authApi } from '@/lib/auth'

const email = ref('')
const sent = ref(false)
const error = ref('')
const busy = ref(false)

async function submit() {
  error.value = ''
  busy.value = true
  const { error: err } = await authApi.requestPasswordReset(email.value, '/reset-password')
  busy.value = false
  if (err) {
    error.value = err
    return
  }
  sent.value = true
}
</script>

<template>
  <AuthLayout title="Forgot password" subtitle="We'll email you a reset link">
    <Alert v-if="sent" data-testid="sent">
      <AlertDescription>If that email exists, a reset link is on its way.</AlertDescription>
    </Alert>
    <form v-else class="space-y-4" @submit.prevent="submit">
      <Alert v-if="error" variant="destructive" data-testid="error">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
      <div class="grid gap-2">
        <Label for="email">Email</Label>
        <Input id="email" v-model="email" type="email" autocomplete="email" required />
      </div>
      <Button type="submit" class="w-full" :disabled="busy" data-testid="submit">
        {{ busy ? 'Sending…' : 'Email reset link' }}
      </Button>
    </form>
    <p class="mt-5 text-center text-sm text-muted-foreground">
      <RouterLink to="/login" class="font-medium text-foreground hover:underline">
        Back to sign in
      </RouterLink>
    </p>
  </AuthLayout>
</template>
