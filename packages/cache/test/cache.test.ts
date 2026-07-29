import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'bun:test'
import { cache, CacheManager, setDefaultCache } from '../src/manager'
import { Repository } from '../src/repository'
import { configureDatabaseCache, DatabaseStore, FileStore, MemoryStore, RedisStore } from '../src/store'

const dir = mkdtempSync(join(tmpdir(), 'cache-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const stores = [
  { name: 'memory', make: () => new Repository(new MemoryStore()) },
  {
    name: 'file',
    make: () => new Repository(new FileStore(join(dir, Math.random().toString(36).slice(2)))),
  },
] as const

for (const s of stores) {
  describe(`cache repository (${s.name})`, () => {
    test('put/get/has/missing/forget/flush', async () => {
      const c = s.make()
      await c.put('a', 1)
      expect(await c.get('a')).toBe(1)
      expect(await c.has('a')).toBe(true)
      expect(await c.missing('b')).toBe(true)
      expect(await c.get('b', 'def')).toBe('def')
      await c.forget('a')
      expect(await c.has('a')).toBe(false)
      await c.put('x', 1)
      await c.flush()
      expect(await c.has('x')).toBe(false)
    })

    test('add only stores when absent', async () => {
      const c = s.make()
      expect(await c.add('k', 'first')).toBe(true)
      expect(await c.add('k', 'second')).toBe(false)
      expect(await c.get('k')).toBe('first')
    })

    test('remember / rememberForever compute once', async () => {
      const c = s.make()
      let calls = 0
      const factory = () => {
        calls++
        return 'computed'
      }
      expect(await c.remember('r', 60, factory)).toBe('computed')
      expect(await c.remember('r', 60, factory)).toBe('computed')
      expect(calls).toBe(1)

      expect(await c.rememberForever('rf', () => 42)).toBe(42)
    })

    test('remember coalesces concurrent misses — only one factory() call, not a thundering herd', async () => {
      const c = s.make()
      let calls = 0
      const factory = async () => {
        calls++
        await new Promise(resolve => setTimeout(resolve, 20)) // simulate a slow DB/API call
        return 'computed-concurrently'
      }

      // 10 "requests" racing the same cold key at once.
      const results = await Promise.all(
        Array.from({ length: 10 }, () => c.remember('stampede', 60, factory)),
      )

      expect(calls).toBe(1) // the slow factory only ran once
      expect(results).toEqual(Array.from<string>({ length: 10 }).fill('computed-concurrently'))
    })

    test('pull retrieves then deletes', async () => {
      const c = s.make()
      await c.put('p', 'v')
      expect(await c.pull('p')).toBe('v')
      expect(await c.has('p')).toBe(false)
    })

    test('increment / decrement / forever', async () => {
      const c = s.make()
      expect(await c.increment('n')).toBe(1)
      expect(await c.increment('n', 4)).toBe(5)
      expect(await c.decrement('n', 2)).toBe(3)
      await c.forever('f', 'kept')
      expect(await c.get('f')).toBe('kept')
    })

    test('ttl expiry', async () => {
      const c = s.make()
      await c.put('t', 'soon', 0.02) // 20ms
      expect(await c.get('t')).toBe('soon')
      await new Promise(r => setTimeout(r, 40))
      expect(await c.get('t')).toBeUndefined()
    })

    test('tags: store, read, and flush a group without touching others', async () => {
      const c = s.make()
      await c.tags(['people', 'authors']).put('john', { name: 'John' })
      await c.tags('places').put('paris', { name: 'Paris' })
      await c.put('untagged', 'plain')

      expect(await c.tags(['people', 'authors']).get<{ name: string }>('john')).toEqual({ name: 'John' })
      // Tag order doesn't matter.
      expect(await c.tags(['authors', 'people']).get<{ name: string }>('john')).toEqual({ name: 'John' })
      // A tagged entry isn't visible through the untagged repository (namespaced key).
      expect(await c.get('john')).toBeUndefined()

      // Flushing one tag orphans entries carrying it...
      await c.tags('people').flush()
      expect(await c.tags(['people', 'authors']).get('john')).toBeUndefined()
      // ...but leaves other tags and untagged entries intact.
      expect(await c.tags('places').get<{ name: string }>('paris')).toEqual({ name: 'Paris' })
      expect(await c.get('untagged')).toBe('plain')
    })

    test('tags: remember + forget + add are tag-scoped', async () => {
      const c = s.make()
      let calls = 0
      const compute = () => {
        calls++
        return 'v'
      }
      expect(await c.tags('t').rememberForever('k', compute)).toBe('v')
      expect(await c.tags('t').rememberForever('k', compute)).toBe('v')
      expect(calls).toBe(1) // cached on the second call

      expect(await c.tags('t').add('k', 'other')).toBe(false) // already present
      await c.tags('t').forget('k')
      expect(await c.tags('t').get('k')).toBeUndefined()
    })
  })
}

describe('database cache store (via adapter)', () => {
  test('get/put/remember/increment through an injected adapter', async () => {
    const store = require('../src/store') as typeof import('../src/store')
    const { DatabaseStore, configureDatabaseCache } = store
    const rows = new Map<string, { value: string, expiresAt: number | null }>()
    configureDatabaseCache({
      read: async key => rows.get(key),
      write: async (key, value, expiresAt) => void rows.set(key, { value, expiresAt }),
      forget: async key => void rows.delete(key),
      flush: async () => rows.clear(),
    })
    const c = new Repository(new DatabaseStore())
    await c.put('a', { n: 1 })
    expect(await c.get('a')).toEqual({ n: 1 })
    expect(await c.remember('b', 60, () => 'v')).toBe('v')
    expect(await c.increment('hits', 3)).toBe(3)
    await c.forget('a')
    expect(await c.has('a')).toBe(false)
  })

  test('uses the adapter\'s atomic increment() when the adapter provides one', async () => {
    const store = require('../src/store') as typeof import('../src/store')
    const { DatabaseStore, configureDatabaseCache } = store
    const counters = new Map<string, number>()
    let atomicIncrementCalls = 0
    configureDatabaseCache({
      read: async () => undefined,
      write: async () => {},
      forget: async () => {},
      flush: async () => {},
      increment: async (key, by) => {
        atomicIncrementCalls++
        const next = (counters.get(key) ?? 0) + by
        counters.set(key, next)
        return next
      },
    })
    const c = new Repository(new DatabaseStore())
    expect(await c.increment('views', 5)).toBe(5)
    expect(await c.increment('views', 5)).toBe(10)
    expect(atomicIncrementCalls).toBe(2) // went through the adapter's atomic path, not read-then-write
  })
})

// Fake Redis client (implements `send`) so store logic is testable without a server.
class FakeRedis {
  readonly map = new Map<string, string>()
  async send(command: string, args: string[]): Promise<unknown> {
    const [key] = args
    switch (command) {
      case 'GET':
        return this.map.get(key as string) ?? null
      case 'SET':
        this.map.set(key as string, args[1] as string)
        return 'OK'
      case 'DEL':
        this.map.delete(key as string)
        return 1
      case 'INCRBY': {
        const n = Number(this.map.get(key as string) ?? 0) + Number(args[1])
        this.map.set(key as string, String(n))
        return n
      }
      case 'DECRBY': {
        const n = Number(this.map.get(key as string) ?? 0) - Number(args[1])
        this.map.set(key as string, String(n))
        return n
      }
      case 'FLUSHDB':
        this.map.clear()
        return 'OK'
      default:
        return null
    }
  }
}

describe('redis cache store (fake client — logic only)', () => {
  test('get/put/increment/forget via RedisStore', async () => {
    const { RedisStore } = require('../src/store') as typeof import('../src/store')
    const c = new Repository(new RedisStore(new FakeRedis()))
    await c.put('a', { n: 1 })
    expect(await c.get('a')).toEqual({ n: 1 })
    expect(await c.increment('hits', 2)).toBe(2)
    expect(await c.get('hits')).toBe(2)
    await c.forget('a')
    expect(await c.has('a')).toBe(false)
  })
})

describe('CacheManager + cache() helper', () => {
  test('resolves stores; cache() uses the default', async () => {
    const manager = new CacheManager({
      default: 'memory',
      stores: { memory: { driver: 'memory' } },
    })
    setDefaultCache(manager)
    await cache().put('hello', 'world')
    expect(await cache().get('hello')).toBe('world')
    expect(manager.store('memory')).toBe(manager.store()) // same default instance
  })
})

// Regression suite for a 2026-07-29 correctness audit. Each of these passed
// review by inspection and failed the moment it was actually run concurrently.
describe('cache concurrency + expiry regressions', () => {
  test('increment past an expired window keeps counting', async () => {
    // `expiresAt` used to be copied from the ALREADY-EXPIRED entry, so the
    // rewritten value was dead on arrival: the counter reset to 1 and then
    // could never climb past it. A counter that silently stops counting is
    // worse than one that resets.
    const store = new MemoryStore()
    await store.put('hits', 5, 0.02)
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(await store.increment('hits')).toBe(1)
    expect(await store.increment('hits')).toBe(2)
  })

  test('concurrent writes to a cold tag do not lose data', async () => {
    // Each concurrent caller used to mint its own tag version, so all but the
    // last wrote under a namespace nobody would read again — and reported
    // success while doing it.
    const cache = new Repository(new MemoryStore())
    await Promise.all([
      cache.tags('posts').put('x', 1),
      cache.tags('posts').put('y', 2),
    ])
    expect(await cache.tags('posts').get('x')).toBe(1)
    expect(await cache.tags('posts').get('y')).toBe(2)
  })

  test('tags().remember() coalesces like the untagged path', async () => {
    const cache = new Repository(new MemoryStore())
    let runs = 0
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        cache.tags('t').remember('k', 60, async () => {
          runs++
          return 'computed'
        })),
    )
    expect(runs).toBe(1) // was 10 — adding .tags() silently dropped protection
    expect(results.every(r => r === 'computed')).toBe(true)
  })

  test('flushing one tag still leaves other tags alone', async () => {
    const cache = new Repository(new MemoryStore())
    await cache.tags('a').put('ka', 1)
    await cache.tags('b').put('kb', 2)
    await cache.tags('a').flush()
    expect(await cache.tags('a').get('ka')).toBeUndefined()
    expect(await cache.tags('b').get('kb')).toBe(2)
  })

  test('DatabaseStore.increment keeps a live window and resets an expired one', async () => {
    // The fallback path called `put(key, next)` with no seconds, writing
    // expiresAt: null — so a still-live TTL'd counter went immortal on its
    // first increment, unlike every other store.
    const rows = new Map<string, { value: string, expiresAt: number | null }>()
    configureDatabaseCache({
      read: async k => rows.get(k),
      write: async (k, v, e) => void rows.set(k, { value: v, expiresAt: e }),
      forget: async k => void rows.delete(k),
      flush: async () => rows.clear(),
    })
    const db = new DatabaseStore()

    await db.put('live', 5, 60)
    expect(await db.increment('live')).toBe(6)
    expect(rows.get('live')!.expiresAt).not.toBeNull() // window survived

    await db.put('gone', 9, 0.02)
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(await db.increment('gone')).toBe(1) // reset, not 9 + 1
    expect(await db.increment('gone')).toBe(2) // and keeps climbing
  })

  test('RedisStore.flush deletes only its own prefix, not the whole database', async () => {
    // Was FLUSHDB, which also destroyed sessions/throttle/queue state living
    // in the same (shared) Redis database.
    const keys = new Map([['cache:one', '1'], ['cache:two', '2'], ['sess:keep', 'x']])
    const commands: string[] = []
    const client = {
      async send(command: string, args: string[]) {
        commands.push(command)
        if (command === 'SCAN')
          return ['0', [...keys.keys()].filter(k => k.startsWith('cache:'))]
        if (command === 'DEL') {
          for (const k of args) keys.delete(k)
          return args.length
        }
        return null
      },
    }
    await new RedisStore(client).flush()
    expect(commands).not.toContain('FLUSHDB')
    expect([...keys.keys()]).toEqual(['sess:keep'])
  })
})
