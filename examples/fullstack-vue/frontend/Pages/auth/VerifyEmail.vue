<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3'
import { ref } from 'vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import AuthLayout from '@/Layouts/AuthLayout.vue'
import { authApi } from '@/lib/auth'

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
    <Alert v-if="sent" data-testid="sent">
      <AlertDescription>Verification email sent.</AlertDescription>
    </Alert>
    <p class="mb-4 text-sm text-muted-foreground">
      Click the link in the email to activate your account. Didn't get it?
    </p>
    <div class="space-y-2">
      <Button class="w-full" :disabled="busy" data-testid="resend" @click="resend">
        {{ busy ? 'Sending…' : 'Resend verification email' }}
      </Button>
      <Button variant="ghost" class="w-full" data-testid="logout" @click="logout">
        Log out
      </Button>
    </div>
  </AuthLayout>
</template>
