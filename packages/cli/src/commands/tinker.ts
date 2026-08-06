import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { comment, error, info } from '../io'
import { buildTinkerSeed } from '../tinker-context'
import { contextNames, createReplContext, evaluateLine, IncompleteInputError } from '../tinker-eval'

/**
 * `elyvel tinker` — a REPL with the application booted (Laravel's
 * `artisan tinker`). The value was never the REPL itself; it is the REPL with
 * config loaded, providers booted, and the database connected, so
 * `await User.find(1)` works the moment the prompt appears.
 *
 * What's in scope comes from `buildTinkerSeed` (shared with `@elyvel/boost`'s
 * MCP tinker tool): `app`, `config()`, every export of every file in
 * `app/models/`, and the everyday helpers of whichever packages the app
 * installed.
 */
export async function tinker(): Promise<number> {
  const cwd = process.cwd()
  if (!existsSync(join(cwd, 'config'))) {
    error('This does not look like an elyvel app (no config/ directory here).')
    return 1
  }

  // Boot the real application. Imports resolve from the app's cwd, so these are
  // the app's own package versions — not the CLI's.
  const core = (await import('@elyvel/core')) as unknown as Record<string, unknown>
  const createApp = core.createApp as (opts: object) => Promise<{ config: { get(key: string, fallback?: unknown): unknown } }>
  const app = await createApp({ basePath: cwd, autoloadRoutes: false })

  const { seed, models } = await buildTinkerSeed(cwd, app, core)
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
