import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

/**
 * Vite build for the Inertia client + SSR bundle.
 *   vite build            → client assets + manifest under public/build
 *   vite build --ssr      → SSR bundle under public/build/ssr (imported in-process by the server)
 * During dev, run `vite` and the server injects the dev client instead.
 */
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [vue()],
  base: '/build/', // built asset (chunk) imports resolve under the served /build path
  publicDir: false, // we serve /build ourselves; outDir lives under public/

  build: isSsrBuild
    ? { ssr: true, outDir: 'public/build/ssr', emptyOutDir: true, rollupOptions: { input: 'resources/js/ssr.ts' } }
    : {
        manifest: true,
        outDir: 'public/build',
        emptyOutDir: true,
        // Two entries: the Inertia app and the plain-Vue SPA (Mode B).
        rollupOptions: { input: { app: 'resources/js/app.ts', spa: 'resources/js/spa.ts' } },
      },
}))
