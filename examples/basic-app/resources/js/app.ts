import { createInertiaApp } from '@inertiajs/vue3'
import { createApp, h } from 'vue'

/** Inertia + Vue client entry. Vite bundles this; the server boots it via data-page. */
createInertiaApp({
  resolve: (name) => {
    const pages = import.meta.glob('./Pages/**/*.vue', { eager: true })
    return pages[`./Pages/${name}.vue`] as never
  },
  setup({ el, App, props, plugin }) {
    createApp({ render: () => h(App, props) })
      .use(plugin)
      .mount(el)
  },
})
