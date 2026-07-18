import { existsSync, readFileSync } from 'node:fs'

export interface ViteOptions {
  /** Client entry, e.g. `resources/js/app.ts`. */
  entry: string
  /** Dev server URL (used when no build manifest is found). */
  devUrl?: string
  /** Path to the production build manifest (Vite's `manifest.json`). */
  manifest?: string
  /** Public URL base where built assets are served. */
  base?: string
}

interface ManifestChunk {
  file: string
  css?: string[]
}

/**
 * Produce the `<script>`/`<link>` tags for a Vite client entry. In production,
 * emit the hashed assets from the build manifest; otherwise assume the Vite
 * dev server (HMR) and emit the dev client + entry. Framework-agnostic — used
 * by both the Inertia adapter and the standalone `spa()` helper.
 *
 * The manifest is only trusted in production (`APP_ENV`/`NODE_ENV`). A stale
 * `public/build/` left over from an earlier `vite build` — e.g. after
 * switching back to `elyvel serve` for local dev — would otherwise still be
 * picked up just because the file exists, serving assets that no longer
 * match the running source with no warning, just a confusing client-side error.
 */
export function viteTags(options: ViteOptions): string {
  const base = options.base ?? '/build/'
  const manifestPath = options.manifest ?? 'public/build/.vite/manifest.json'
  const isProduction = (process.env.APP_ENV ?? process.env.NODE_ENV) === 'production'

  if (isProduction && existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<
        string,
        ManifestChunk
      >
      const chunk = manifest[options.entry]
      if (chunk) {
        const css = (chunk.css ?? [])
          .map(f => `<link rel="stylesheet" href="${base}${f}">`)
          .join('')
        return `${css}<script type="module" src="${base}${chunk.file}"></script>`
      }
    }
    catch {
      // fall through to dev tags
    }
  }

  // Dev: the Vite dev server serves under its configured `base` (e.g. /build/),
  // so the injected client + entry URLs must include it — `${dev}/@vite/client`
  // without the base 404s.
  const dev = (options.devUrl ?? 'http://localhost:5173').replace(/\/$/, '')
  return (
    `<script type="module" src="${dev}${base}@vite/client"></script>`
    + `<script type="module" src="${dev}${base}${options.entry}"></script>`
  )
}
