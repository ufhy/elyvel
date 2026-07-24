import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'

/**
 * Default theme + a one-time, client-side browser-language redirect. VitePress
 * is a static site (no server-side content negotiation), so on the very first
 * visit we send an `id-*` browser to the `/id/` locale. It fires at most once
 * (a flag in localStorage), so it never fights a manual choice from the navbar
 * language switcher afterwards.
 */
export default {
  extends: DefaultTheme,
  enhanceApp() {
    if (typeof window === 'undefined')
      return

    const SEEN = 'elyvel-docs-lang-seen'
    if (localStorage.getItem(SEEN))
      return
    localStorage.setItem(SEEN, '1')

    const base = import.meta.env.BASE_URL // e.g. "/elyvel/"
    const path = location.pathname
    const idHome = `${base}id`
    const alreadyId = path.startsWith(`${base}id/`) || path.replace(/\/$/, '') === idHome

    if (navigator.language.toLowerCase().startsWith('id') && !alreadyId) {
      location.replace(path.replace(base, `${base}id/`) + location.search + location.hash)
    }
  },
} satisfies Theme
