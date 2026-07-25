import type { User } from '@/types'
import { readonly, ref } from 'vue'
import { authApi } from '@/lib/auth'

/**
 * Client-side auth state, shared app-wide. Backed by the Better Auth JSON API
 * (`/api/auth/*`). `load()` fetches the session once (used by the router guard);
 * `refresh()` re-fetches after profile changes; `signOut()` clears it.
 */
const user = ref<User | null>(null)
const ready = ref(false)

async function load(): Promise<User | null> {
  if (!ready.value)
    await refresh()
  return user.value
}

async function refresh(): Promise<User | null> {
  const res = await fetch('/api/auth/get-session', { credentials: 'same-origin' })
  const data = await res.json().catch(() => null)
  user.value = data?.user ?? null
  ready.value = true
  return user.value
}

async function signOut(): Promise<void> {
  await authApi.signOut()
  user.value = null
}

export function useAuth() {
  return { user: readonly(user), ready: readonly(ready), load, refresh, signOut }
}
