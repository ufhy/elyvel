import { createInertiaApp } from '@inertiajs/vue3'
import { renderToString } from '@vue/server-renderer'
import { createSSRApp, h } from 'vue'

/**
 * Inertia SSR entry. Default-exports a `render(page)` returning `{ head, body }`.
 * The elysia-ravel Inertia adapter imports this built bundle in-process (Bun).
 */
export default (page: Parameters<typeof createInertiaApp>[0]['page']) =>
  createInertiaApp({
    page,
    render: renderToString,
    resolve: (name) => {
      const pages = import.meta.glob('./Pages/**/*.vue', { eager: true })
      return pages[`./Pages/${name}.vue`] as never
    },
    setup({ App, props, plugin }) {
      return createSSRApp({ render: () => h(App, props) }).use(plugin)
    },
  })
