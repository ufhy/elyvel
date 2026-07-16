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
 * Produce the `<script>`/`<link>` tags for a Vite client entry. If a build
 * manifest exists, emit the hashed production assets; otherwise assume the Vite
 * dev server (HMR) and emit the dev client + entry. Framework-agnostic — used
 * by both the Inertia adapter and the standalone `spa()` helper.
 */
export function viteTags(options: ViteOptions): string {
  const base = options.base ?? '/build/'
  const manifestPath = options.manifest ?? 'public/build/.vite/manifest.json'

  if (existsSync(manifestPath)) {
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

  const dev = (options.devUrl ?? 'http://localhost:5173').replace(/\/$/, '')
  return (
    `<script type="module" src="${dev}/@vite/client"></script>`
    + `<script type="module" src="${dev}/${options.entry}"></script>`
  )
}
