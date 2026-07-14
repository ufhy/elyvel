import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** A fresh application key — `base64:` + 64 random bytes (Laravel's format). */
function generateKey(): string {
  return `base64:${randomBytes(64).toString('base64')}`
}

/**
 * `ravel key:generate [--show] [--force]` — set APP_KEY in the app's `.env`
 * (Laravel's `key:generate`). `--show` prints a key without writing; `--force`
 * allows overwriting an existing key when APP_ENV=production.
 */
export async function keyGenerate(flags: Record<string, string | boolean> = {}): Promise<number> {
  const key = generateKey()

  if (flags.show) {
    console.log(key)
    return 0
  }

  const envPath = join(process.cwd(), '.env')
  if (!existsSync(envPath)) {
    // Seed .env from .env.example if present, otherwise there's nothing to key.
    const example = join(process.cwd(), '.env.example')
    if (!existsSync(example)) {
      console.error('✗ No .env or .env.example found. Run this inside your app directory.')
      return 1
    }
    await Bun.write(envPath, await readFile(example, 'utf8'))
    console.log('  created .env from .env.example')
  }

  const env = await readFile(envPath, 'utf8')

  // Guard (Laravel's confirmToProceed): overwriting an existing key only needs
  // confirmation in production. Rotating the key logs out every session and
  // makes `encrypted` columns unreadable — so in production require --force.
  const currentKey = env.match(/^APP_KEY=(.*)$/m)?.[1]?.trim() ?? ''
  const appEnv = (env.match(/^APP_ENV=(.*)$/m)?.[1] ?? process.env.APP_ENV ?? 'local')
    .trim()
    .replace(/^["']|["']$/g, '')
  if (currentKey.length > 0 && appEnv === 'production' && !flags.force) {
    console.error(
      '✗ APP_KEY is already set and APP_ENV=production.\n' +
        '  Rotating it invalidates all sessions and makes `encrypted` columns\n' +
        '  unreadable. Re-run with --force if you really mean to.',
    )
    return 1
  }

  // Replace an existing APP_KEY= line, or append one if it's missing.
  const next = /^APP_KEY=.*$/m.test(env)
    ? env.replace(/^APP_KEY=.*$/m, `APP_KEY=${key}`)
    : `${env.replace(/\n?$/, '\n')}APP_KEY=${key}\n`
  await Bun.write(envPath, next)

  console.log('✓ Application key set in .env')
  return 0
}
