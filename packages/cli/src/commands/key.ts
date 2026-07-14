import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** A fresh application key — `base64:` + 32 random bytes (Laravel's format). */
function generateKey(): string {
  return `base64:${randomBytes(32).toString('base64')}`
}

/**
 * `ravel key:generate [--show]` — set APP_KEY in the app's `.env`
 * (Laravel's `key:generate`). `--show` just prints a key without writing.
 */
export async function keyGenerate(flags: Record<string, string | boolean> = {}): Promise<number> {
  const key = generateKey()

  if (flags.show) {
    console.log(key)
    return 0
  }

  const envPath = join(process.cwd(), '.env')
  if (!existsSync(envPath)) {
    console.error('✗ No .env file found. Create one first:\n    cp .env.example .env')
    return 1
  }

  const env = await readFile(envPath, 'utf8')
  // Replace an existing APP_KEY= line, or append one if it's missing.
  const next = /^APP_KEY=.*$/m.test(env)
    ? env.replace(/^APP_KEY=.*$/m, `APP_KEY=${key}`)
    : `${env.replace(/\n?$/, '\n')}APP_KEY=${key}\n`
  await Bun.write(envPath, next)

  console.log('✓ Application key set in .env')
  return 0
}
