import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

/**
 * Vite build for the Inertia client. Outputs a manifest under public/build so
 * the server (@elysia-ravel/inertia) can resolve hashed asset URLs in prod;
 * in dev, run `vite` and the server injects the dev client instead.
 */
export default defineConfig({
  plugins: [vue()],
  build: {
    manifest: true,
    outDir: 'public/build',
    emptyOutDir: true,
    rollupOptions: { input: 'resources/js/app.ts' },
  },
})
