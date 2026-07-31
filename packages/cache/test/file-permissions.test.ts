import { mkdtempSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { FileStore } from '../src/store'

/**
 * Same class as the file session store: default modes left every cache entry
 * world-readable, and a cache entry is whatever the app found expensive to
 * recompute — routinely a user record or a token.
 */
describe('file cache storage is not world-readable', () => {
  test('the directory is 0700 and each entry 0600', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'elyvel-cache-')), 'cache')
    const store = new FileStore(dir)

    await store.put('user:7', { email: 'ada@example.test' }, 120)

    expect(statSync(dir).mode & 0o777).toBe(0o700)
    const file = join(dir, readdirSync(dir)[0] as string)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(statSync(file).mode & 0o044).toBe(0)
  })

  test('flush recreates the directory with the same mode', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'elyvel-cache-')), 'cache')
    const store = new FileStore(dir)
    await store.put('k', 'v', 120)

    await store.flush()

    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(await store.get('k')).toBeUndefined()
  })

  test('values still round-trip', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'elyvel-cache-')), 'cache')
    const store = new FileStore(dir)
    await store.put('k', { a: 1 }, 120)
    expect(await store.get('k')).toEqual({ a: 1 })
  })
})
