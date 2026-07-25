<script setup lang="ts">
import { ref } from 'vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/composables/useAuth'
import SettingsLayout from '@/Layouts/settings/SettingsLayout.vue'
import { authApi } from '@/lib/auth'

const { user, refresh } = useAuth()
const name = ref(user.value?.name ?? '')
const status = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
  status.value = ''
  error.value = ''
  busy.value = true
  const { error: err } = await authApi.updateUser(name.value)
  busy.value = false
  if (err) {
    error.value = err
    return
  }
  await refresh()
  status.value = 'Profile updated.'
}
</script>

<template>
  <SettingsLayout>
    <div class="max-w-lg">
      <h2 class="text-lg font-semibold text-foreground">
        Profile
      </h2>
      <p class="mt-1 text-sm text-muted-foreground">
        Update your account's profile information.
      </p>
      <form class="mt-6 space-y-4" @submit.prevent="submit">
        <Alert v-if="status" data-testid="status">
          <AlertDescription>{{ status }}</AlertDescription>
        </Alert>
        <Alert v-if="error" variant="destructive" data-testid="error">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
        <div class="grid gap-2">
          <Label for="name">Name</Label>
          <Input id="name" v-model="name" autocomplete="name" required />
        </div>
        <div class="grid gap-2">
          <Label for="email">Email</Label>
          <Input id="email" :model-value="user?.email" disabled />
        </div>
        <Button type="submit" :disabled="busy" data-testid="save">
          {{ busy ? 'Saving…' : 'Save' }}
        </Button>
      </form>
    </div>
  </SettingsLayout>
</template>
