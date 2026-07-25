import { onMounted, ref } from 'vue'

export type Appearance = 'light' | 'dark' | 'system'

/** Apply a theme to <html> by toggling the `dark` class Tailwind keys off. */
export function updateTheme(value: Appearance): void {
  if (typeof window === 'undefined')
    return
  const dark = value === 'dark'
    || (value === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

function setCookie(name: string, value: string, days = 365): void {
  if (typeof document === 'undefined')
    return
  document.cookie = `${name}=${value};path=/;max-age=${days * 24 * 60 * 60};SameSite=Lax`
}

function storedAppearance(): Appearance | null {
  if (typeof window === 'undefined')
    return null
  return localStorage.getItem('appearance') as Appearance | null
}

/**
 * Boot the theme from the saved preference (or `system`) and keep it in sync
 * with the OS setting. Call once on the client entry — the inline `<head>`
 * script already prevents a flash on first paint; this wires up reactivity.
 */
export function initializeTheme(): void {
  if (typeof window === 'undefined')
    return
  updateTheme(storedAppearance() ?? 'system')
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => updateTheme(storedAppearance() ?? 'system'))
}

const appearance = ref<Appearance>('system')

export function useAppearance() {
  onMounted(() => {
    const saved = storedAppearance()
    if (saved)
      appearance.value = saved
  })

  function updateAppearance(value: Appearance): void {
    appearance.value = value
    localStorage.setItem('appearance', value) // client-side persistence
    setCookie('appearance', value) // so the server/inline script can read it (SSR)
    updateTheme(value)
  }

  return { appearance, updateAppearance }
}
