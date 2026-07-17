import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

/**
 * Vite build for the Vue SPA (no Inertia, no SSR).
 *   vite build → client assets + manifest under public/build
 * During dev, run `vite` (or `ravel serve` + `vite`) and the server injects the
 * dev client instead of the built manifest.
 */
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./resources/js', import.meta.url)) },
  },
  base: '/build/',
  publicDir: false,
  build: {
    manifest: true,
    outDir: 'public/build',
    emptyOutDir: true,
    rollupOptions: { input: 'resources/js/app.ts' },
  },
})
