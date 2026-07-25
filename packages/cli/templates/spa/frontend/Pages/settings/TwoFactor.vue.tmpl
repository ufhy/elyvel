<script setup lang="ts">
import QRCode from 'qrcode'
import { ref } from 'vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/composables/useAuth'
import SettingsLayout from '@/Layouts/settings/SettingsLayout.vue'
import { authApi } from '@/lib/auth'

const { user } = useAuth()
const enabled = ref(
  Boolean(user.value?.twoFactorEnabled),
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
      <h2 class="text-lg font-semibold text-foreground">
        Two-factor authentication
      </h2>
      <p class="mt-1 text-sm text-muted-foreground">
        Add a one-time code from an authenticator app on top of your password.
      </p>

      <Alert v-if="status" class="mt-6" data-testid="status">
        <AlertDescription>{{ status }}</AlertDescription>
      </Alert>
      <Alert v-if="error" variant="destructive" class="mt-6" data-testid="error">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <!-- Enabled: offer to turn it off. -->
      <div v-if="enabled && step === 'idle'" class="mt-6 space-y-4">
        <p class="text-sm font-medium text-foreground" data-testid="tfa-on">
          Two-factor authentication is enabled.
        </p>
        <form class="space-y-4" @submit.prevent="disable">
          <div class="grid gap-2">
            <Label for="disable-pw">Confirm password to disable</Label>
            <Input id="disable-pw" v-model="password" type="password" autocomplete="current-password" required />
          </div>
          <Button type="submit" variant="outline" :disabled="busy" data-testid="disable">
            {{ busy ? 'Disabling…' : 'Disable' }}
          </Button>
        </form>
      </div>

      <!-- Disabled: start enrollment by confirming the password. -->
      <form v-else-if="step === 'idle'" class="mt-6 space-y-4" @submit.prevent="begin">
        <div class="grid gap-2">
          <Label for="enable-pw">Confirm password to enable</Label>
          <Input id="enable-pw" v-model="password" type="password" autocomplete="current-password" required />
        </div>
        <Button type="submit" :disabled="busy" data-testid="enable">
          {{ busy ? 'Starting…' : 'Enable' }}
        </Button>
      </form>

      <!-- Setup: scan the QR, save backup codes, confirm a code. -->
      <div v-else class="mt-6 space-y-5">
        <div>
          <p class="text-sm text-muted-foreground">
            Scan this with your authenticator app, then enter the 6-digit code.
          </p>
          <img v-if="qr" :src="qr" alt="TOTP QR code" class="mt-3 h-44 w-44 rounded-lg border border-border bg-white p-1" data-testid="tfa-qr">
        </div>
        <div v-if="backupCodes.length">
          <p class="text-sm font-medium text-foreground">
            Backup codes — save these somewhere safe:
          </p>
          <ul class="mt-2 grid grid-cols-2 gap-1 font-mono text-sm text-muted-foreground" data-testid="backup-codes">
            <li v-for="c in backupCodes" :key="c">
              {{ c }}
            </li>
          </ul>
        </div>
        <form class="space-y-4" @submit.prevent="confirm">
          <div class="grid gap-2">
            <Label for="tfa-code">Authentication code</Label>
            <Input id="tfa-code" v-model="code" autocomplete="one-time-code" required />
          </div>
          <Button type="submit" :disabled="busy" data-testid="confirm">
            {{ busy ? 'Verifying…' : 'Confirm' }}
          </Button>
        </form>
      </div>
    </div>
  </SettingsLayout>
</template>
