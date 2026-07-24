import { fileURLToPath, URL } from 'node:url'
import inertia from '@inertiajs/vite'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

/**
 * Vite build for the Inertia client + SSR bundle.
 *   vite build          → client assets + manifest under public/build
 *   vite build --ssr    → SSR bundle under public/build/ssr (imported in-process)
 * During dev, run `vite` and the server injects the dev client instead.
 *
 * `inertia({ ssr: false })` — the plugin's page-resolution shorthand (`pages:
 * './Pages'` in app.ts/ssr.ts) is used, but its OWN SSR auto-bootstrap is off:
 * it always wraps the render export with `createServer(...)` (a listening
 * HTTP server), which doesn't fit elyvel's in-process SSR (the built bundle
 * is `import()`-ed directly — see `@elyvel/inertia`'s `SsrOptions.render`).
 */
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [vue(), tailwindcss(), inertia({ ssr: false })],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./resources/js', import.meta.url)) },
  },
  base: '/build/',
  publicDir: false,
  build: isSsrBuild
    ? { ssr: true, outDir: 'public/build/ssr', emptyOutDir: true, rollupOptions: { input: 'resources/js/ssr.ts' } }
    : {
        manifest: true,
        outDir: 'public/build',
        emptyOutDir: true,
        rollupOptions: { input: 'resources/js/app.ts' },
      },
}))
