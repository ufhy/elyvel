/**
 * The seeding half of tinker, shared between `elyvel tinker` (the TTY REPL)
 * and `@elyvel/mcp`'s MCP `tinker` tool — one definition of "what's in
 * scope in a tinker session", not two drifting ones.
 *
 * Everything is best-effort: an app without the queue package simply doesn't
 * get `dispatch`, rather than the session refusing to start.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { error } from './io'

export interface TinkerSeed {
  seed: Record<string, unknown>
  /** Names of the models loaded from `app/models/`, sorted. */
  models: string[]
}

/**
 * Build the seed for a tinker session: `app`, `config()`, `Context`/`Crypt`,
 * the everyday helpers of whichever @elyvel packages the app installed, and
 * every export of every file in `app/models/`.
 *
 * `core` is the caller's already-imported `@elyvel/core` module — passed in
 * so the session uses the exact copy the app booted with.
 */
export async function buildTinkerSeed(
  cwd: string,
  app: { config: { get(key: string, fallback?: unknown): unknown } },
  core: Record<string, unknown>,
): Promise<TinkerSeed> {
  const seed: Record<string, unknown> = {}
  seed.app = app
  seed.config = (key: string, fallback?: unknown) => app.config.get(key, fallback)
  seed.Context = core.Context
  seed.Crypt = core.Crypt

  // Resolution starts at the app's cwd (so these are the APP's package
  // versions), then falls back to core's own directory for peers the app
  // never declares directly (e.g. @elyvel/support under Bun's isolated
  // linker), and finally to this package's.
  const coreDir = dirnameOf(resolveFrom('@elyvel/core', [cwd]) ?? import.meta.url)
  const roots = [cwd, coreDir, import.meta.dir]
  await seedFrom(seed, '@elyvel/support', ['Str', 'Arr', 'Collection', 'Pipeline', 'Process', 'Concurrency'], roots)
  await seedFrom(seed, '@elyvel/database', ['schema'], roots)
  await seedFrom(seed, '@elyvel/queue', ['dispatch', 'dispatchSync'], roots)
  await seedFrom(seed, '@elyvel/mail', ['Mail'], roots)
  await seedFrom(seed, '@elyvel/notifications', ['notify'], roots)
  await seedFrom(seed, '@elyvel/auth', ['AuthUser', 'AuthAccount', 'Gate', 'Hash'], roots)

  const models = await loadModels(cwd, seed)
  return { seed, models }
}

/** Copy the named exports that exist; skip silently when the package isn't installed. */
async function seedFrom(
  seed: Record<string, unknown>,
  pkg: string,
  names: string[],
  roots: string[],
): Promise<void> {
  const resolved = resolveFrom(pkg, roots)
  if (!resolved)
    return // not installed in this app — the helper simply isn't in the session
  try {
    const mod = (await import(resolved)) as Record<string, unknown>
    for (const name of names) {
      if (name in mod)
        seed[name] = mod[name]
    }
  }
  catch (err) {
    error(`Could not load ${pkg}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** First directory the package resolves from, or null when none does. */
function resolveFrom(pkg: string, roots: string[]): string | null {
  for (const root of roots) {
    try {
      return Bun.resolveSync(pkg, root)
    }
    catch {
      // keep looking
    }
  }
  return null
}

function dirnameOf(pathOrUrl: string): string {
  return join(pathOrUrl.replace(/^file:\/\//, ''), '..')
}

/**
 * Import every model in `app/models/` and seed its exports, so `User.find(1)`
 * works without an import statement — the single convenience that makes tinker
 * tinker. A model file that fails to import is reported and skipped: one broken
 * model must not take the whole session down.
 */
async function loadModels(cwd: string, seed: Record<string, unknown>): Promise<string[]> {
  const dir = join(cwd, 'app', 'models')
  if (!existsSync(dir))
    return []
  const names: string[] = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.ts') && !file.endsWith('.js'))
      continue
    try {
      const mod = (await import(join(dir, file))) as Record<string, unknown>
      for (const [name, value] of Object.entries(mod)) {
        if (typeof value === 'function') {
          seed[name] = value
          names.push(name)
        }
      }
    }
    catch (err) {
      error(`Skipping ${file}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return names.sort()
}
