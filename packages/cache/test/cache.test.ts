import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'bun:test'
import { CacheManager, cache, setDefaultCache } from '../src/manager'
import { FileStore, MemoryStore } from '../src/store'
import { Repository } from '../src/repository'

const dir = mkdtempSync(join(tmpdir(), 'cache-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const stores = [
  { name: 'memory', make: () => new Repository(new MemoryStore()) },
  { name: 'file', make: () => new Repository(new FileStore(join(dir, Math.random().toString(36).slice(2)))) },
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
      await new Promise((r) => setTimeout(r, 40))
      expect(await c.get('t')).toBeUndefined()
    })
  })
}

describe('database cache store (via adapter)', () => {
  test('get/put/remember/increment through an injected adapter', async () => {
    const { DatabaseStore, configureDatabaseCache } =
      require('../src/store') as typeof import('../src/store')
    const rows = new Map<string, { value: string; expiresAt: number | null }>()
    configureDatabaseCache({
      read: async (key) => rows.get(key),
      write: async (key, value, expiresAt) => void rows.set(key, { value, expiresAt }),
      forget: async (key) => void rows.delete(key),
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
    const manager = new CacheManager({ default: 'memory', stores: { memory: { driver: 'memory' } } })
    setDefaultCache(manager)
    await cache().put('hello', 'world')
    expect(await cache().get('hello')).toBe('world')
    expect(manager.store('memory')).toBe(manager.store()) // same default instance
  })
})
