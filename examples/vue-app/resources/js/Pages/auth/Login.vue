<script setup lang="ts">
import { Link, router } from '@inertiajs/vue3'
import { ref } from 'vue'
import UiAlert from '../../components/UiAlert.vue'
import UiButton from '../../components/UiButton.vue'
import UiInput from '../../components/UiInput.vue'
import AuthLayout from '../../Layouts/AuthLayout.vue'
import { authApi } from '../../lib/auth'

const email = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
  error.value = ''
  busy.value = true
  const { error: err } = await authApi.signIn(email.value, password.value)
  busy.value = false
  if (err) {
    error.value = err
    return
  }
  router.visit('/dashboard')
}
</script>

<template>
  <AuthLayout title="Welcome back" subtitle="Sign in to your account">
    <form class="space-y-4" @submit.prevent="submit">
      <UiAlert v-if="error" data-testid="error">
        {{ error }}
      </UiAlert>
      <UiInput v-model="email" label="Email" type="email" autocomplete="email" />
      <UiInput v-model="password" label="Password" type="password" autocomplete="current-password" />
      <div class="text-right text-sm">
        <Link href="/forgot-password" class="text-indigo-600 hover:underline">
          Forgot password?
        </Link>
      </div>
      <UiButton type="submit" :disabled="busy" data-testid="submit">
        {{ busy ? 'Signing in…' : 'Sign in' }}
      </UiButton>
    </form>
    <p class="mt-5 text-center text-sm text-gray-500 dark:text-gray-400">
      No account?
      <Link href="/register" class="font-medium text-indigo-600 hover:underline">
        Create one
      </Link>
    </p>
  </AuthLayout>
</template>
