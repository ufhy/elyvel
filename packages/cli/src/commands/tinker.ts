import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { comment, error, info } from '../io'
import { contextNames, createReplContext, evaluateLine, IncompleteInputError } from '../tinker-eval'

/**
 * `elyvel tinker` — a REPL with the application booted (Laravel's
 * `artisan tinker`). The value was never the REPL itself; it is the REPL with
 * config loaded, providers booted, and the database connected, so
 * `await User.find(1)` works the moment the prompt appears.
 *
 * Everything the session needs is pre-seeded:
 * - `app` — the booted Application
 * - every export of every file in `app/models/`
 * - the everyday helpers (Str, Arr, Crypt, Context, dispatch, notify, Mail, …),
 *   each imported best-effort: an app without the queue package simply doesn't
 *   get `dispatch`, rather than tinker refusing to start.
 */
export async function tinker(): Promise<number> {
  const cwd = process.cwd()
  if (!existsSync(join(cwd, 'config'))) {
    error('This does not look like an elyvel app (no config/ directory here).')
    return 1
  }

  const seed: Record<string, unknown> = {}

  // Boot the real application. Imports resolve from the app's cwd, so these are
  // the app's own package versions — not the CLI's.
  const core = await import('@elyvel/core')
  const app = await core.createApp({ basePath: cwd, autoloadRoutes: false })
  seed.app = app
  seed.config = (key: string, fallback?: unknown) => app.config.get(key, fallback as never)
  seed.Context = core.Context
  seed.Crypt = (core as Record<string, unknown>).Crypt

  // Everyday helpers, each optional — presence depends on what the app
  // installed. Resolution starts at the app's cwd (so these are the APP's
  // package versions), then falls back to core's own directory for peers the
  // app never declares directly (e.g. @elyvel/support under Bun's isolated
  // linker), and finally to the CLI's. Resolving from this file alone found
  // whatever the CLI happened to have and missed the rest.
  const coreDir = dirnameOf(resolveFrom('@elyvel/core', [cwd]) ?? import.meta.url)
  const roots = [cwd, coreDir, import.meta.dir]
  await seedFrom(seed, '@elyvel/support', ['Str', 'Arr', 'Collection', 'Pipeline', 'Process', 'Concurrency'], roots)
  await seedFrom(seed, '@elyvel/database', ['schema'], roots)
  await seedFrom(seed, '@elyvel/queue', ['dispatch', 'dispatchSync'], roots)
  await seedFrom(seed, '@elyvel/mail', ['Mail'], roots)
  await seedFrom(seed, '@elyvel/notifications', ['notify'], roots)
  await seedFrom(seed, '@elyvel/auth', ['AuthUser', 'AuthAccount', 'Gate', 'Hash'], roots)

  const models = await loadModels(cwd, seed)

  const context = createReplContext(seed)

  info(`elyvel tinker — ${String(app.config.get('app.name', 'app'))} booted`)
  if (models.length > 0)
    comment(`Models: ${models.join(', ')}`)
  comment('`.vars` lists what is defined, `.exit` leaves. `_` is the last result.')

  const rl = createInterface({ input: process.stdin, output: process.stdout })

  // Async iteration rather than question(): on Bun, pre-buffered lines (piped
  // stdin, pasted blocks) only ever feed the FIRST question(), and a closed
  // stream leaves the pending question() hanging forever — both already bitten
  // this repo once. `for await` drains buffered lines correctly and simply ends
  // on Ctrl+D / end of pipe.
  let buffer = ''
  process.stdout.write('> ')
  for await (const line of rl) {
    const code = buffer ? `${buffer}\n${line}` : line
    buffer = ''

    const bare = code.trim()
    if (bare === '.exit' || bare === 'exit')
      break
    if (bare === '.vars')
      comment(contextNames(context).join(', ') || '(nothing defined yet)')

    if (bare !== '' && bare !== '//' && bare !== '.vars') {
      try {
        const value = await evaluateLine(code, context)
        if (value !== undefined)
          console.log(Bun.inspect(value, { colors: true, depth: 4 }))
      }
      catch (err) {
        if (err instanceof IncompleteInputError) {
          buffer = code // unfinished block — keep reading on a continuation prompt
        }
        else {
          // An error in the user's line is a result to show, never a reason to
          // die: losing the session (and every variable in it) over a typo is
          // the worst thing a REPL can do.
          error(err instanceof Error ? `${err.name}: ${err.message}` : String(err))
        }
      }
    }

    process.stdout.write(buffer ? '... ' : '> ')
  }

  rl.close()
  process.stdout.write('\n')
  return 0
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
