<script setup lang="ts">
import { router } from '@inertiajs/vue3'
import { ref } from 'vue'
import UiAlert from '../../components/UiAlert.vue'
import UiButton from '../../components/UiButton.vue'
import UiInput from '../../components/UiInput.vue'
import AuthLayout from '../../Layouts/AuthLayout.vue'
import { authApi } from '../../lib/auth'

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
      <UiAlert v-if="error" data-testid="error">
        {{ error }}
      </UiAlert>
      <UiInput
        v-model="code"
        :label="useBackup ? 'Backup code' : 'Authentication code'"
        autocomplete="one-time-code"
      />
      <label v-if="!useBackup" class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <input v-model="trustDevice" type="checkbox" class="rounded border-gray-300">
        Trust this device for 60 days
      </label>
      <UiButton type="submit" :disabled="busy" data-testid="verify">
        {{ busy ? 'Verifying…' : 'Verify' }}
      </UiButton>
    </form>
    <button
      type="button"
      class="mt-5 w-full text-center text-sm font-medium text-indigo-600 hover:underline"
      data-testid="toggle-backup"
      @click="useBackup = !useBackup"
    >
      {{ useBackup ? 'Use an authenticator code instead' : 'Use a backup code instead' }}
    </button>
  </AuthLayout>
</template>
