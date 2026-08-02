import type { CacheStore } from '../src/store'
import { describe, expect, test } from 'bun:test'
import { CacheManager } from '../src/manager'

/** A store the framework has never heard of — e.g. memcached, DynamoDB. */
class CountingStore implements CacheStore {
  readonly writes: string[] = []
  private readonly data = new Map<string, unknown>()
  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined
  }

  async put(key: string, value: unknown): Promise<void> {
    this.writes.push(key)
    this.data.set(key, value)
  }

  async forget(key: string): Promise<void> {
    this.data.delete(key)
  }

  async flush(): Promise<void> {
    this.data.clear()
  }

  async increment(key: string, by = 1): Promise<number> {
    const next = Number(this.data.get(key) ?? 0) + by
    this.data.set(key, next)
    return next
  }

  async decrement(key: string, by = 1): Promise<number> {
    return this.increment(key, -by)
  }
}

describe('CacheManager.extend', () => {
  test('a registered store is resolvable from config', async () => {
    const store = new CountingStore()
    const manager = new CacheManager({ default: 'memcached', stores: { memcached: { driver: 'memcached' } } })
    manager.extend('memcached', () => store)

    await manager.store().put('k', 'v', 60)
    expect(await manager.store().get('k')).toBe('v')
    expect(store.writes).toEqual(['k'])
  })

  test('extending after the store was built still takes effect', async () => {
    const manager = new CacheManager({ default: 'memory', stores: { memory: { driver: 'memory' } } })
    await manager.store().put('k', 'from-builtin', 60)

    const store = new CountingStore()
    manager.extend('memory', () => store)
    await manager.store().put('k', 'from-custom', 60)

    expect(store.writes).toEqual(['k'])
  })

  test('an unknown driver names the ones that exist', () => {
    const manager = new CacheManager({ stores: { x: { driver: 'nope' } } as never })
    expect(() => manager.store('x')).toThrow(/Available: database, file, memory, redis/)
  })
})
