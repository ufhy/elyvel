import { createApp, h, onMounted, ref } from 'vue'

/**
 * A plain Vite + Vue SPA — NO Inertia. It's served single-origin by the server
 * (see routes/dashboard.ts via `spa()`) and talks to the JSON API with fetch.
 * For end-to-end typed API calls, use Eden (`treaty<Api>()`); see the DX docs.
 */
const App = {
  setup() {
    const health = ref('loading…')
    onMounted(async () => {
      const res = await fetch('/api/health')
      health.value = JSON.stringify(await res.json())
    })
    return () =>
      h('main', { style: 'max-width:32rem;margin:3rem auto;font-family:sans-serif' }, [
        h('h1', 'Vite SPA (no Inertia)'),
        h('p', { 'data-testid': 'health' }, `API says: ${health.value}`),
        h('p', 'Client-side Vue, data from the elysia-ravel JSON API.'),
      ])
  },
}

createApp(App).mount('#app')
