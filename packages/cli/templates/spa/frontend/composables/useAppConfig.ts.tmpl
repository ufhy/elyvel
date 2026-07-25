import { readonly, ref } from 'vue'

/** App feature flags from GET /api/config (enabled social providers + 2FA). */
interface AppConfig {
  social: string[]
  twoFactor: boolean
}

const config = ref<AppConfig>({ social: [], twoFactor: true })
const ready = ref(false)

async function load(): Promise<AppConfig> {
  if (!ready.value) {
    const res = await fetch('/api/config', { credentials: 'same-origin' })
    const data = await res.json().catch(() => null)
    if (data)
      config.value = data
    ready.value = true
  }
  return config.value
}

export function useAppConfig() {
  return { config: readonly(config), ready: readonly(ready), load }
}
