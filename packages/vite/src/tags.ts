import { existsSync, readFileSync } from 'node:fs'

/**
 * Where the `elyvel()` Vite plugin writes the hot file. Duplicated in
 * `plugin.mjs` — which must stay plain JavaScript, because Vite loads
 * `vite.config.ts` under Node and this package ships TypeScript. The two
 * constants are asserted equal in `test/plugin.test.ts`.
 */
export const DEFAULT_HOT_FILE = 'public/hot'

export interface ViteOptions {
  /** Client entry, e.g. `frontend/app.ts`. */
  entry: string
  /**
   * Force dev tags against this URL, ignoring the hot file. For setups the dev
   * server can't describe itself — a container publishing a different host, a
   * tunnel. Leave unset and the running dev server is detected instead.
   */
  devUrl?: string
  /** Path to the production build manifest (Vite's `manifest.json`). */
  manifest?: string
  /** Public URL base where built assets are served. */
  base?: string
  /** Hot file written by the `elyvel()` Vite plugin. Default `public/hot`. */
  hotFile?: string
}

interface ManifestChunk {
  file: string
  css?: string[]
}

/**
 * Parsed manifests, per path, for the life of the process — Laravel keeps the
 * same `static $manifests` cache. It exists because `viteTags` is now called on
 * every render rather than once at boot: the hot file can appear or disappear
 * while the server runs, so the dev-vs-build question has to be asked each time,
 * but re-parsing the manifest for every request would be waste. A build cannot
 * change under a running production server without a restart.
 */
const manifestCache = new Map<string, Record<string, ManifestChunk>>()

/**
 * Produce the `<script>`/`<link>` tags for a Vite client entry. Emits dev-server
 * tags while a Vite dev server is running, and the hashed assets from the build
 * manifest otherwise. Framework-agnostic — used by both the Inertia adapter and
 * the standalone `spa()` helper.
 *
 * "Is a dev server running" is answered by the hot file the `elyvel()` Vite
 * plugin writes and removes, which is the same mechanism (and the same default
 * path) as Laravel's. It replaced an `APP_ENV`/`NODE_ENV` check, which asked a
 * different question and answered this one wrong in both directions: a stale
 * `public/build/` served in dev, and a production deploy with `APP_ENV` unset
 * sending `http://localhost:5173/...` asset URLs to real visitors — page renders,
 * every asset 404s, server logs nothing.
 */
export function viteTags(options: ViteOptions): string {
  if (viteDisabled)
    return ''

  const base = options.base ?? '/build/'
  const manifestPath = options.manifest ?? 'public/build/.vite/manifest.json'
  const hotFile = options.hotFile ?? DEFAULT_HOT_FILE

  // The hot file already carries Vite's `base` (that is how the plugin writes
  // it, Laravel-compatible), so only the asset path is appended here.
  if (options.devUrl !== undefined || existsSync(hotFile)) {
    const origin = options.devUrl !== undefined
      ? `${options.devUrl.replace(/\/+$/, '')}${base.replace(/\/$/, '')}`
      : readFileSync(hotFile, 'utf8').trim().replace(/\/+$/, '')
    return (
      `<script type="module" src="${origin}/@vite/client"></script>`
      + `<script type="module" src="${origin}/${options.entry}"></script>`
    )
  }

  if (!existsSync(manifestPath)) {
    // Neither a running dev server nor a build. Previously this fell through to
    // dev tags and shipped localhost URLs to whoever was watching.
    throw new Error(
      `[elyvel] No Vite dev server and no build manifest at "${manifestPath}". `
      + 'Run `vite` for development (the `elyvel()` plugin writes the hot file), '
      + 'or `vite build` before serving.',
    )
  }

  // A manifest problem must be LOUD: quietly emitting dev tags instead is how
  // real users ended up loading assets from a dev server that was never running.
  let manifest = manifestCache.get(manifestPath)
  if (!manifest) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, ManifestChunk>
    }
    catch (error) {
      throw new Error(
        `[elyvel] Could not read the Vite manifest at "${manifestPath}": `
        + `${error instanceof Error ? error.message : String(error)}. `
        + 'Run `vite build` before serving in production.',
      )
    }
    manifestCache.set(manifestPath, manifest)
  }
  const chunk = manifest[options.entry]
  if (!chunk) {
    throw new Error(
      `[elyvel] Entry "${options.entry}" is not in the Vite manifest at `
      + `"${manifestPath}" (found: ${Object.keys(manifest).join(', ') || 'nothing'}). `
      + 'Check the entry name matches your vite config input.',
    )
  }
  const css = (chunk.css ?? [])
    .map(f => `<link rel="stylesheet" href="${base}${f}">`)
    .join('')
  return `${css}<script type="module" src="${base}${chunk.file}"></script>`
}

/** Drops the cached manifests. For tests, and for a process that rebuilds in place. */
export function clearViteManifestCache(): void {
  manifestCache.clear()
}

let viteDisabled = false

/**
 * Make `viteTags()` return nothing. Laravel's `withoutVite()` test helper, same
 * purpose: a test suite renders pages without running `vite build` first, and the
 * assets are not what it is testing. Without this, every render throws — which is
 * correct in production (the alternative was silently shipping dev-server URLs to
 * real visitors) but useless in a test.
 */
export function withoutVite(): void {
  viteDisabled = true
}

/** Undo {@link withoutVite}. */
export function withVite(): void {
  viteDisabled = false
}
