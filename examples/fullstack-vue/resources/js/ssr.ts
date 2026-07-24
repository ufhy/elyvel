import type { Page } from '@elyvel/inertia'
import type { DefineComponent, Plugin } from 'vue'
import { createInertiaApp } from '@inertiajs/vue3'
import { renderToString } from '@vue/server-renderer'
import { createSSRApp, h } from 'vue'

// `@inertiajs/core` types `Page<T>.props.errors` as `Errors & ErrorBag` — an
// intersection no concrete error object can satisfy (elyvel doesn't implement
// Inertia's grouped "error bags" feature). This is the one narrow, unavoidable
// bridge needed; every other field stays fully type-checked.
function bridgeErrors(page: Page) {
  return { ...page, props: { ...page.props, errors: page.props.errors as never } }
}

// `App`/`props` here are typed via Vue's own `h()` (what they're passed to) —
// `createInertiaApp`'s internal `SetupOptions`/`InertiaApp` types aren't public.
interface SetupArgs {
  el: null
  App: Parameters<typeof h>[0]
  props: Parameters<typeof h>[1]
  plugin: Plugin
}

/**
 * Inertia SSR entry. Default-exports a `render(page)` returning `{ head, body }`.
 * The elyvel Inertia adapter imports this built bundle in-process (Bun).
 */
export default (page: Page) =>
  createInertiaApp({
    page: bridgeErrors(page),
    render: renderToString,
    resolve: (name: string) => {
      const pages = import.meta.glob<{ default: DefineComponent }>('./Pages/**/*.vue', { eager: true })
      return pages[`./Pages/${name}.vue`]!
    },
    setup({ App, props, plugin }: SetupArgs) {
      return createSSRApp({ render: () => h(App, props) }).use(plugin)
    },
  })
