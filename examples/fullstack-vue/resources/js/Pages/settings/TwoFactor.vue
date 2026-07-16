<script setup lang="ts">
import { usePage } from '@inertiajs/vue3'
import QRCode from 'qrcode'
import { ref } from 'vue'
import UiAlert from '../../components/UiAlert.vue'
import UiButton from '../../components/UiButton.vue'
import UiInput from '../../components/UiInput.vue'
import SettingsLayout from '../../Layouts/settings/SettingsLayout.vue'
import { authApi } from '../../lib/auth'

const page = usePage()
const enabled = ref(
  Boolean((page.props as { user?: { twoFactorEnabled?: boolean } }).user?.twoFactorEnabled),
)

const password = ref('')
const code = ref('')
const qr = ref('')
const backupCodes = ref<string[]>([])
const step = ref<'idle' | 'setup'>('idle')
const status = ref('')
const error = ref('')
const busy = ref(false)

// Step 1: confirm password → receive the TOTP secret (as a QR) + backup codes.
async function begin(): Promise<void> {
  status.value = ''
  error.value = ''
  busy.value = true
  const { data, error: err } = await authApi.enableTwoFactor(password.value)
  busy.value = false
  password.value = ''
  if (err) {
    error.value = err
    return
  }
  const d = data as { totpURI: string, backupCodes: string[] }
  qr.value = await QRCode.toDataURL(d.totpURI)
  backupCodes.value = d.backupCodes
  step.value = 'setup'
}

// Step 2: confirm a code from the authenticator to finish enrollment.
async function confirm(): Promise<void> {
  error.value = ''
  busy.value = true
  const { error: err } = await authApi.verifyTotp(code.value)
  busy.value = false
  code.value = ''
  if (err) {
    error.value = err
    return
  }
  enabled.value = true
  step.value = 'idle'
  status.value = 'Two-factor authentication is now on.'
}

async function disable(): Promise<void> {
  status.value = ''
  error.value = ''
  busy.value = true
  const { error: err } = await authApi.disableTwoFactor(password.value)
  busy.value = false
  password.value = ''
  if (err) {
    error.value = err
    return
  }
  enabled.value = false
  qr.value = ''
  backupCodes.value = []
  status.value = 'Two-factor authentication is now off.'
}
</script>

<template>
  <SettingsLayout>
    <div class="max-w-lg">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
        Two-factor authentication
      </h2>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        Add a one-time code from an authenticator app on top of your password.
      </p>

      <UiAlert v-if="status" tone="success" class="mt-6" data-testid="status">
        {{ status }}
      </UiAlert>
      <UiAlert v-if="error" class="mt-6" data-testid="error">
        {{ error }}
      </UiAlert>

      <!-- Enabled: offer to turn it off. -->
      <div v-if="enabled && step === 'idle'" class="mt-6 space-y-4">
        <p class="text-sm font-medium text-green-600 dark:text-green-400" data-testid="tfa-on">
          Two-factor authentication is enabled.
        </p>
        <form class="space-y-4" @submit.prevent="disable">
          <UiInput v-model="password" label="Confirm password to disable" type="password" autocomplete="current-password" />
          <div class="w-40">
            <UiButton type="submit" variant="ghost" :disabled="busy" data-testid="disable">
              {{ busy ? 'Disabling…' : 'Disable' }}
            </UiButton>
          </div>
        </form>
      </div>

      <!-- Disabled: start enrollment by confirming the password. -->
      <form v-else-if="step === 'idle'" class="mt-6 space-y-4" @submit.prevent="begin">
        <UiInput v-model="password" label="Confirm password to enable" type="password" autocomplete="current-password" />
        <div class="w-40">
          <UiButton type="submit" :disabled="busy" data-testid="enable">
            {{ busy ? 'Starting…' : 'Enable' }}
          </UiButton>
        </div>
      </form>

      <!-- Setup: scan the QR, save backup codes, confirm a code. -->
      <div v-else class="mt-6 space-y-5">
        <div>
          <p class="text-sm text-gray-600 dark:text-gray-300">
            Scan this with your authenticator app, then enter the 6-digit code.
          </p>
          <img v-if="qr" :src="qr" alt="TOTP QR code" class="mt-3 h-44 w-44 rounded-lg border border-gray-200 dark:border-gray-800" data-testid="tfa-qr">
        </div>
        <div v-if="backupCodes.length">
          <p class="text-sm font-medium text-gray-700 dark:text-gray-200">
            Backup codes — save these somewhere safe:
          </p>
          <ul class="mt-2 grid grid-cols-2 gap-1 font-mono text-sm text-gray-600 dark:text-gray-300" data-testid="backup-codes">
            <li v-for="c in backupCodes" :key="c">
              {{ c }}
            </li>
          </ul>
        </div>
        <form class="space-y-4" @submit.prevent="confirm">
          <UiInput v-model="code" label="Authentication code" autocomplete="one-time-code" />
          <div class="w-40">
            <UiButton type="submit" :disabled="busy" data-testid="confirm">
              {{ busy ? 'Verifying…' : 'Confirm' }}
            </UiButton>
          </div>
        </form>
      </div>
    </div>
  </SettingsLayout>
</template>
