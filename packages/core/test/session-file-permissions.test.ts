import { mkdtempSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { FileSessionStore } from '../src/session'

/**
 * Regression: the store used the default modes, so a session file landed 0644 in
 * a 0755 directory — world-readable. Each file holds the user's id, their CSRF
 * token and any flashed data, so every local user or process on the box could
 * read every session. PHP writes session files 0600 for exactly this reason.
 *
 * Surfaced by CodeQL's `js/insecure-temporary-file`. The alert itself was about
 * predictable names in a shared temp directory, which does not apply here (the
 * temp file sits beside the session file and carries 48 bits of randomness) — but
 * looking at the code it pointed to found this.
 */
describe('file session storage is not world-readable', () => {
  test('the directory is 0700 and each session file 0600', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'elyvel-sess-')), 'sessions')
    const store = new FileSessionStore(dir)

    await store.write('a'.repeat(32), { userId: 7, csrf: 'a-secret-token' }, 120)

    expect(statSync(dir).mode & 0o777).toBe(0o700)
    const file = join(dir, readdirSync(dir)[0] as string)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    // Neither group nor other may read it.
    expect(statSync(file).mode & 0o044).toBe(0)
  })

  test('the data still round-trips', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'elyvel-sess-')), 'sessions')
    const store = new FileSessionStore(dir)
    const id = 'b'.repeat(32)

    await store.write(id, { userId: 7 }, 120)
    expect(await store.read(id)).toEqual({ userId: 7 })
  })
})
