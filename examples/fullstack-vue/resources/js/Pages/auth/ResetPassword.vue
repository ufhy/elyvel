<script setup lang="ts">
import { Link, router } from '@inertiajs/vue3'
import { onMounted, ref } from 'vue'
import UiAlert from '../../components/UiAlert.vue'
import UiButton from '../../components/UiButton.vue'
import UiInput from '../../components/UiInput.vue'
import AuthLayout from '../../Layouts/AuthLayout.vue'
import { authApi } from '../../lib/auth'

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
  router.visit('/login')
}
</script>

<template>
  <AuthLayout title="Reset password" subtitle="Choose a new password">
    <form class="space-y-4" @submit.prevent="submit">
      <UiAlert v-if="error" data-testid="error">
        {{ error }}
      </UiAlert>
      <UiAlert v-if="!token" data-testid="no-token">
        Missing or invalid reset token.
      </UiAlert>
      <UiInput v-model="password" label="New password" type="password" autocomplete="new-password" />
      <UiButton type="submit" :disabled="busy || !token" data-testid="submit">
        {{ busy ? 'Saving…' : 'Reset password' }}
      </UiButton>
    </form>
    <p class="mt-5 text-center text-sm text-gray-500 dark:text-gray-400">
      <Link href="/login" class="font-medium text-indigo-600 hover:underline">
        Back to sign in
      </Link>
    </p>
  </AuthLayout>
</template>
