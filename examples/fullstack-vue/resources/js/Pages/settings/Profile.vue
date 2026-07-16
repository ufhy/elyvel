<script setup lang="ts">
import { usePage } from '@inertiajs/vue3'
import { ref } from 'vue'
import UiAlert from '../../components/UiAlert.vue'
import UiButton from '../../components/UiButton.vue'
import UiInput from '../../components/UiInput.vue'
import SettingsLayout from '../../Layouts/settings/SettingsLayout.vue'
import { authApi } from '../../lib/auth'

const page = usePage()
const user = () => (page.props as { user?: { name?: string, email?: string } }).user
const name = ref(user()?.name ?? '')
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
  status.value = 'Profile updated.'
}
</script>

<template>
  <SettingsLayout>
    <div class="max-w-lg">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
        Profile
      </h2>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        Update your account's profile information.
      </p>
      <form class="mt-6 space-y-4" @submit.prevent="submit">
        <UiAlert v-if="status" tone="success" data-testid="status">
          {{ status }}
        </UiAlert>
        <UiAlert v-if="error" data-testid="error">
          {{ error }}
        </UiAlert>
        <UiInput v-model="name" label="Name" autocomplete="name" />
        <label class="block">
          <span class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Email</span>
          <input
            :value="user()?.email"
            disabled
            class="block w-full rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-800"
          >
        </label>
        <div class="w-32">
          <UiButton type="submit" :disabled="busy" data-testid="save">
            {{ busy ? 'Saving…' : 'Save' }}
          </UiButton>
        </div>
      </form>
    </div>
  </SettingsLayout>
</template>
