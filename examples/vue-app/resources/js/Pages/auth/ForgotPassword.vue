<script setup lang="ts">
import { Link } from '@inertiajs/vue3'
import { ref } from 'vue'
import AuthLayout from '../../Layouts/AuthLayout.vue'
import UiAlert from '../../components/UiAlert.vue'
import UiButton from '../../components/UiButton.vue'
import UiInput from '../../components/UiInput.vue'
import { authApi } from '../../lib/auth'

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
    <UiAlert v-if="sent" tone="success" data-testid="sent">
      If that email exists, a reset link is on its way.
    </UiAlert>
    <form v-else class="space-y-4" @submit.prevent="submit">
      <UiAlert v-if="error" data-testid="error">{{ error }}</UiAlert>
      <UiInput v-model="email" label="Email" type="email" autocomplete="email" />
      <UiButton type="submit" :disabled="busy" data-testid="submit">
        {{ busy ? 'Sending…' : 'Email reset link' }}
      </UiButton>
    </form>
    <p class="mt-5 text-center text-sm text-gray-500 dark:text-gray-400">
      <Link href="/login" class="font-medium text-indigo-600 hover:underline">Back to sign in</Link>
    </p>
  </AuthLayout>
</template>
