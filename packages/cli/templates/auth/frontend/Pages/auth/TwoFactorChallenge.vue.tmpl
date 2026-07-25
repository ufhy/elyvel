<script setup lang="ts">
import { router } from '@inertiajs/vue3'
import { ref } from 'vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import AuthLayout from '@/Layouts/AuthLayout.vue'
import { authApi } from '@/lib/auth'

const code = ref('')
const useBackup = ref(false)
const trustDevice = ref(false)
const error = ref('')
const busy = ref(false)

async function submit(): Promise<void> {
  error.value = ''
  busy.value = true
  const { error: err } = useBackup.value
    ? await authApi.verifyBackupCode(code.value)
    : await authApi.verifyTotp(code.value, trustDevice.value)
  busy.value = false
  if (err) {
    error.value = err
    return
  }
  router.visit('/dashboard')
}
</script>

<template>
  <AuthLayout title="Two-factor authentication" subtitle="Enter the code to finish signing in">
    <form class="space-y-4" @submit.prevent="submit">
      <Alert v-if="error" variant="destructive" data-testid="error">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
      <div class="grid gap-2">
        <Label for="code">{{ useBackup ? 'Backup code' : 'Authentication code' }}</Label>
        <Input id="code" v-model="code" autocomplete="one-time-code" required />
      </div>
      <label v-if="!useBackup" class="flex items-center gap-2 text-sm text-muted-foreground">
        <input v-model="trustDevice" type="checkbox" class="rounded border-input">
        Trust this device for 60 days
      </label>
      <Button type="submit" class="w-full" :disabled="busy" data-testid="verify">
        {{ busy ? 'Verifying…' : 'Verify' }}
      </Button>
    </form>
    <button
      type="button"
      class="mt-5 w-full text-center text-sm font-medium text-muted-foreground hover:text-foreground"
      data-testid="toggle-backup"
      @click="useBackup = !useBackup"
    >
      {{ useBackup ? 'Use an authenticator code instead' : 'Use a backup code instead' }}
    </button>
  </AuthLayout>
</template>
