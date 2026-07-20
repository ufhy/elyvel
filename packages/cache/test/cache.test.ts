import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'bun:test'
import { cache, CacheManager, setDefaultCache } from '../src/manager'
import { Repository } from '../src/repository'
import { FileStore, MemoryStore } from '../src/store'

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
