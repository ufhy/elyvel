# @elyvel/inertia

The server side of [Inertia.js](https://inertiajs.com) for elyvel — build a
full-stack SPA with **Vue, React, or Svelte** and no separate API. Your
controllers return a component name + props; Inertia handles the rest.

## Server (identical for all three frameworks)

```ts
import { Inertia, inertia } from '@elyvel/inertia'
import { route } from '@elyvel/core'

export default route()
  .use(inertia({
    vite: { entry: 'frontend/app.ts' },
    ssr: { bundle: 'public/build/ssr/ssr.js' }, // optional
  }))
  .get('/users', async () => Inertia.render('Users/Index', {
    users: await User.all(),
    stats: Inertia.defer(() => computeStats()),   // v2: loaded after first paint
    feed: Inertia.merge(() => nextPage()),         // v2: appended on scroll
  }))
```

`Inertia.share()`, `optional()`, `defer()`, `merge()`/`deepMerge()`, `once()`,
and `.encryptHistory()`/`.clearHistory()` are all supported. Flashed validation
errors are auto-shared as `page.props.errors`. **Nothing below changes the
server** — only the client entry and Vite plugin differ per framework.

## Client — Vue (see `examples/basic-app`)

```ts
// frontend/app.ts
import { createInertiaApp } from '@inertiajs/vue3'
import { createApp, h } from 'vue'

createInertiaApp({
  resolve: (name) => {
    const pages = import.meta.glob('./Pages/**/*.vue', { eager: true })
    return pages[`./Pages/${name}.vue`]
  },
  setup: ({ el, App, props, plugin }) => createApp({ render: () => h(App, props) }).use(plugin).mount(el),
})
```

Vite: `@vitejs/plugin-vue`. SSR entry (`ssr.ts`) uses `@vue/server-renderer`'s
`renderToString` and `createSSRApp` — default-export `(page) => createInertiaApp({ page, render: renderToString, ... })`.

## Client — React

```tsx
// frontend/app.tsx
import { createInertiaApp } from '@inertiajs/react'
import { hydrateRoot } from 'react-dom/client'

createInertiaApp({
  resolve: (name) => {
    const pages = import.meta.glob('./Pages/**/*.tsx', { eager: true })
    return pages[`./Pages/${name}.tsx`]
  },
  setup: ({ el, App, props }) => hydrateRoot(el, <App {...props} />),
})
```

SSR entry:

```tsx
// frontend/ssr.tsx
import { createInertiaApp } from '@inertiajs/react'
import ReactDOMServer from 'react-dom/server'

export default (page: object) =>
  createInertiaApp({
    page,
    render: ReactDOMServer.renderToString,
    resolve: (name) => {
      const pages = import.meta.glob('./Pages/**/*.tsx', { eager: true })
      return pages[`./Pages/${name}.tsx`]
    },
    setup: ({ App, props }) => <App {...props} />,
  })
```

Vite: `@vitejs/plugin-react`. Deps: `@inertiajs/react react react-dom`.

## Client — Svelte

```ts
// frontend/app.ts
import { createInertiaApp } from '@inertiajs/svelte'
import { mount } from 'svelte'

createInertiaApp({
  resolve: (name) => {
    const pages = import.meta.glob('./Pages/**/*.svelte', { eager: true })
    return pages[`./Pages/${name}.svelte`]
  },
  setup: ({ el, App, props }) => mount(App, { target: el, props }),
})
```

SSR entry uses `render` from `svelte/server`. Vite:
`@sveltejs/vite-plugin-svelte`. Deps: `@inertiajs/svelte svelte`.

## Vite build

```
vite build            # client → public/build (+ manifest)
vite build --ssr      # SSR bundle → public/build/ssr (imported in-process by the server)
```

The server adapter reads the manifest for hashed asset URLs in production, or
injects the Vite dev-server client during `vite` (HMR).
