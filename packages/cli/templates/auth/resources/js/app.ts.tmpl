import { createInertiaApp } from '@inertiajs/vue3'
import { createApp, h } from 'vue'
import { initializeTheme } from './composables/useAppearance'
import '../css/app.css'

/** Inertia + Vue client entry. Vite bundles this; the server boots it via data-page. */
createInertiaApp({
  // Lazy resolve (no `eager`): each page compiles to its own chunk and is
  // fetched on demand, so the initial bundle stays small. Drop to a smaller app?
  // add `{ eager: true }` and return the module directly for a single bundle.
  resolve: (name) => {
    const pages = import.meta.glob('./Pages/**/*.vue')
    return (pages[`./Pages/${name}.vue`] as () => Promise<unknown>)()
  },
  setup({ el, App, props, plugin }) {
    createApp({ render: () => h(App, props) })
      .use(plugin)
      .mount(el)
  },
})

// Sync the theme with the saved preference + OS changes after hydration.
initializeTheme()
