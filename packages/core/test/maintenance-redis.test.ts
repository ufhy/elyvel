import { afterEach, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import {
  configureMaintenanceStore,
  maintenanceMode,
  RedisMaintenanceStore,
  resetMaintenanceStore,
} from '../src/maintenance'

/** Logic-only fake — no real Redis server, mirrors other packages' Redis fakes. */
class FakeRedis {
  private readonly values = new Map<string, string>()
  async send(command: string, args: string[]): Promise<unknown> {
    const [key] = args
    switch (command) {
      case 'GET':
        return this.values.get(key as string) ?? null
      case 'SET':
        this.values.set(key as string, args[1] as string)
        return 'OK'
      case 'DEL':
        this.values.delete(key as string)
        return 1
      default:
        return null
    }
  }
}

afterEach(() => resetMaintenanceStore())

describe('RedisMaintenanceStore', () => {
  test('read() is null until write(), clear() removes it', async () => {
    const store = new RedisMaintenanceStore(new FakeRedis())
    expect(await store.read()).toBeNull()
    await store.write({ message: 'brb' })
    expect(await store.read()).toEqual({ message: 'brb' })
    await store.clear()
    expect(await store.read()).toBeNull()
  })

  test('two independent instances sharing one Redis see the same down state', async () => {
    // Simulates two app instances, each with their own RedisMaintenanceStore
    // wrapper, both backed by the SAME Redis — proving state is genuinely
    // shared, not per-instance like the file-based default.
    const redis = new FakeRedis()
    const instanceA = new RedisMaintenanceStore(redis)
    const instanceB = new RedisMaintenanceStore(redis)

    await instanceA.write({ message: 'down for A' })
    expect(await instanceB.read()).toEqual({ message: 'down for A' })
  })
})

describe('maintenanceMode() prefers a configured store over the file fallback', () => {
  test('a request-time configureMaintenanceStore() call takes effect (not captured only at mount time)', async () => {
    const app = new Elysia().use(maintenanceMode('/nonexistent/down/file')).get('/', () => 'ok')

    // File fallback: nothing configured yet, file doesn't exist → up.
    const before = await app.handle(new Request('http://localhost/'))
    expect(before.status).toBe(200)

    // Configure a store AFTER the plugin was already mounted (as a
    // ServiceProvider's boot() would, which runs after registerMaintenance()) —
    // it must still be picked up on the next request.
    const store = new RedisMaintenanceStore(new FakeRedis())
    configureMaintenanceStore(store)
    await store.write({ message: 'maintenance via redis' })

    const after = await app.handle(new Request('http://localhost/'))
    expect(after.status).toBe(503)
    expect(await after.text()).toContain('maintenance via redis')
  })
})
