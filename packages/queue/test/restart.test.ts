import type { RedisLike } from '../src/store'
import { describe, expect, test } from 'bun:test'
import { RedisRestartSignal } from '../src/restart'

/** Logic-only fake — no real Redis server, mirrors other packages' Redis fakes. */
class FakeRedis implements RedisLike {
  private readonly values = new Map<string, string>()
  async send(command: string, args: string[]): Promise<unknown> {
    const [key] = args
    switch (command) {
      case 'GET':
        return this.values.get(key as string) ?? null
      case 'SET':
        this.values.set(key as string, args[1] as string)
        return 'OK'
      default:
        return null
    }
  }
}

describe('RedisRestartSignal', () => {
  test('requestedAt() is null until request() is called', async () => {
    const signal = new RedisRestartSignal(new FakeRedis())
    expect(await signal.requestedAt()).toBeNull()
    await signal.request()
    expect(await signal.requestedAt()).toBeGreaterThan(0)
  })

  test('two independent instances sharing one Redis see the same request', async () => {
    // Simulates the real scenario: `queue:restart` and a worker process are
    // two SEPARATE OS processes, each with their own RedisRestartSignal
    // instance — they must agree only because the backing store is shared.
    const redis = new FakeRedis()
    const cliInvocation = new RedisRestartSignal(redis)
    const workerProcess = new RedisRestartSignal(redis)

    expect(await workerProcess.requestedAt()).toBeNull()
    await cliInvocation.request()
    const seenByWorker = await workerProcess.requestedAt()
    expect(seenByWorker).not.toBeNull()
    expect(seenByWorker).toBe(await cliInvocation.requestedAt())
  })

  test('a worker started before the request sees it as newer than its own startedAt', async () => {
    const redis = new FakeRedis()
    const startedAt = Date.now()
    await new Promise(r => setTimeout(r, 5))

    const signal = new RedisRestartSignal(redis)
    await signal.request()
    const requestedAt = await signal.requestedAt()

    expect(requestedAt).not.toBeNull()
    expect(requestedAt!).toBeGreaterThan(startedAt) // mirrors Worker.shouldRestart()'s comparison
  })

  test('a custom key does not collide with the default key', async () => {
    const redis = new FakeRedis()
    const custom = new RedisRestartSignal(redis, 'custom:restart')
    const defaultKey = new RedisRestartSignal(redis)

    await custom.request()
    expect(await defaultKey.requestedAt()).toBeNull() // different key, unaffected
  })
})
