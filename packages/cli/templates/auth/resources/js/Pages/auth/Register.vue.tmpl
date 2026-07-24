<script setup lang="ts">
import { Link, router } from '@inertiajs/vue3'
import { ref } from 'vue'
import SocialButtons from '@/components/SocialButtons.vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import AuthLayout from '@/Layouts/AuthLayout.vue'
import { authApi } from '@/lib/auth'

defineProps<{ socialProviders?: string[] }>()

const name = ref('')
const email = ref('')
const password = ref('')
const passwordConfirmation = ref('')
const error = ref('')
const errors = ref<Record<string, string[]>>({})
const busy = ref(false)

async function submit() {
  error.value = ''
  errors.value = {}
  busy.value = true
  const { error: err, errors: bag } = await authApi.signUp(name.value, email.value, password.value, passwordConfirmation.value)
  busy.value = false
  if (err) {
    errors.value = bag ?? {}
    // Only show the top alert when there's no field-level detail to render.
    error.value = bag && Object.keys(bag).length ? '' : err
    return
  }
  router.visit('/dashboard')
}
</script>

<template>
  <AuthLayout title="Create your account" subtitle="Get started in seconds">
    <form class="space-y-4" @submit.prevent="submit">
      <Alert v-if="error" variant="destructive" data-testid="error">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
      <div class="grid gap-2">
        <Label for="name">Name</Label>
        <Input id="name" v-model="name" autocomplete="name" required />
        <p v-if="errors.name" class="text-sm text-destructive" data-testid="error-name">
          {{ errors.name[0] }}
        </p>
      </div>
      <div class="grid gap-2">
        <Label for="email">Email</Label>
        <Input id="email" v-model="email" type="email" autocomplete="email" required />
        <p v-if="errors.email" class="text-sm text-destructive" data-testid="error-email">
          {{ errors.email[0] }}
        </p>
      </div>
      <div class="grid gap-2">
        <Label for="password">Password</Label>
        <Input id="password" v-model="password" type="password" autocomplete="new-password" required />
        <p v-if="errors.password" class="text-sm text-destructive" data-testid="error-password">
          {{ errors.password[0] }}
        </p>
      </div>
      <div class="grid gap-2">
        <Label for="password_confirmation">Confirm password</Label>
        <Input id="password_confirmation" v-model="passwordConfirmation" type="password" autocomplete="new-password" required />
        <!-- The `confirmed` rule reports a mismatch on the `password` field
             (Laravel-consistent), so it renders under Password above. -->
      </div>
      <Button type="submit" class="w-full" :disabled="busy" data-testid="submit">
        {{ busy ? 'Creating…' : 'Create account' }}
      </Button>
    </form>
    <SocialButtons :providers="socialProviders" />
    <p class="mt-5 text-center text-sm text-muted-foreground">
      Already have an account?
      <Link href="/login" class="font-medium text-foreground hover:underline">
        Sign in
      </Link>
    </p>
  </AuthLayout>
</template>
