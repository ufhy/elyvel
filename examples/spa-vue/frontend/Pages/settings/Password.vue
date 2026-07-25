<script setup lang="ts">
import { ref } from 'vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import SettingsLayout from '@/Layouts/settings/SettingsLayout.vue'
import { authApi } from '@/lib/auth'

const current = ref('')
const next = ref('')
const status = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
  status.value = ''
  error.value = ''
  busy.value = true
  const { error: err } = await authApi.changePassword(current.value, next.value)
  busy.value = false
  if (err) {
    error.value = err
    return
  }
  current.value = ''
  next.value = ''
  status.value = 'Password changed.'
}
</script>

<template>
  <SettingsLayout>
    <div class="max-w-lg">
      <h2 class="text-lg font-semibold text-foreground">
        Password
      </h2>
      <p class="mt-1 text-sm text-muted-foreground">
        Use a long, random password to stay secure.
      </p>
      <form class="mt-6 space-y-4" @submit.prevent="submit">
        <Alert v-if="status" data-testid="status">
          <AlertDescription>{{ status }}</AlertDescription>
        </Alert>
        <Alert v-if="error" variant="destructive" data-testid="error">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
        <div class="grid gap-2">
          <Label for="current">Current password</Label>
          <Input id="current" v-model="current" type="password" autocomplete="current-password" required />
        </div>
        <div class="grid gap-2">
          <Label for="next">New password</Label>
          <Input id="next" v-model="next" type="password" autocomplete="new-password" required />
        </div>
        <Button type="submit" :disabled="busy" data-testid="save">
          {{ busy ? 'Saving…' : 'Change password' }}
        </Button>
      </form>
    </div>
  </SettingsLayout>
</template>
