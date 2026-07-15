<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3'
import { ref } from 'vue'
import UiAlert from '../../components/UiAlert.vue'
import UiButton from '../../components/UiButton.vue'
import AuthLayout from '../../Layouts/AuthLayout.vue'
import { authApi } from '../../lib/auth'

const page = usePage()
const email = () => (page.props as { user?: { email?: string } }).user?.email ?? ''
const sent = ref(false)
const busy = ref(false)

async function resend() {
  busy.value = true
  await authApi.sendVerification(email(), '/dashboard')
  busy.value = false
  sent.value = true
}

async function logout() {
  await authApi.signOut()
  router.visit('/login')
}
</script>

<template>
  <AuthLayout title="Verify your email" :subtitle="`We sent a link to ${email()}`">
    <UiAlert v-if="sent" tone="success" data-testid="sent">Verification email sent.</UiAlert>
    <p class="mb-4 text-sm text-gray-600 dark:text-gray-300">
      Click the link in the email to activate your account. Didn't get it?
    </p>
    <div class="space-y-2">
      <UiButton :disabled="busy" data-testid="resend" @click="resend">
        {{ busy ? 'Sending…' : 'Resend verification email' }}
      </UiButton>
      <UiButton variant="ghost" data-testid="logout" @click="logout">Log out</UiButton>
    </div>
  </AuthLayout>
</template>
