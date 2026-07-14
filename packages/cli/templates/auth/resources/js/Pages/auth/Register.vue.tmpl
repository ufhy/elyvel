<script setup lang="ts">
import { Link, router } from '@inertiajs/vue3'
import { ref } from 'vue'
import UiAlert from '../../components/UiAlert.vue'
import UiButton from '../../components/UiButton.vue'
import UiInput from '../../components/UiInput.vue'
import { authApi } from '../../lib/auth'
import AuthLayout from '../../Layouts/AuthLayout.vue'

const name = ref('')
const email = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
  error.value = ''
  busy.value = true
  const { error: err } = await authApi.signUp(name.value, email.value, password.value)
  busy.value = false
  if (err) {
    error.value = err
    return
  }
  router.visit('/dashboard')
}
</script>

<template>
  <AuthLayout title="Create your account" subtitle="Get started in seconds">
    <form class="space-y-4" @submit.prevent="submit">
      <UiAlert v-if="error" data-testid="error">{{ error }}</UiAlert>
      <UiInput v-model="name" label="Name" autocomplete="name" />
      <UiInput v-model="email" label="Email" type="email" autocomplete="email" />
      <UiInput v-model="password" label="Password" type="password" autocomplete="new-password" />
      <UiButton type="submit" :disabled="busy" data-testid="submit">
        {{ busy ? 'Creating…' : 'Create account' }}
      </UiButton>
    </form>
    <p class="mt-5 text-center text-sm text-gray-500 dark:text-gray-400">
      Already have an account?
      <Link href="/login" class="font-medium text-indigo-600 hover:underline">Sign in</Link>
    </p>
  </AuthLayout>
</template>
