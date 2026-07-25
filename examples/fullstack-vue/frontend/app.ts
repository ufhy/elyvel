import { createInertiaApp } from '@inertiajs/vue3'
import { createApp, h } from 'vue'
import { initializeTheme } from './composables/useAppearance'
import './css/app.css'

/**
 * Inertia + Vue client entry. Vite bundles this; the server boots it via data-page.
 * `pages: './Pages'` is expanded by the `@inertiajs/vite` plugin (vite.config.ts)
 * into the lazy `import.meta.glob` resolver at build time — each page still
 * compiles to its own chunk, fetched on demand.
 */
createInertiaApp({
  pages: './Pages',
  setup({ el, App, props, plugin }) {
    createApp({ render: () => h(App, props) })
      .use(plugin)
      .mount(el!)
  },
})

// Sync the theme with the saved preference + OS changes after hydration.
initializeTheme()
