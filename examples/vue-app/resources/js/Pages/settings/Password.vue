<script setup lang="ts">
import { ref } from 'vue'
import UiAlert from '../../components/UiAlert.vue'
import UiButton from '../../components/UiButton.vue'
import UiInput from '../../components/UiInput.vue'
import { authApi } from '../../lib/auth'
import AppLayout from '../../Layouts/AppLayout.vue'

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
  <AppLayout>
    <div class="max-w-lg">
      <h1 class="text-xl font-bold text-gray-900 dark:text-white">Password</h1>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Use a long, random password to stay secure.</p>
      <form class="mt-6 space-y-4" @submit.prevent="submit">
        <UiAlert v-if="status" tone="success" data-testid="status">{{ status }}</UiAlert>
        <UiAlert v-if="error" data-testid="error">{{ error }}</UiAlert>
        <UiInput v-model="current" label="Current password" type="password" autocomplete="current-password" />
        <UiInput v-model="next" label="New password" type="password" autocomplete="new-password" />
        <div class="w-40">
          <UiButton type="submit" :disabled="busy" data-testid="save">{{ busy ? 'Saving…' : 'Change password' }}</UiButton>
        </div>
      </form>
    </div>
  </AppLayout>
</template>
