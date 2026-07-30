import type { RedisLike } from '../src/store'
import { describe, expect, test } from 'bun:test'
import { Lock, LockTimeoutError, supportsLocks } from '../src/lock'
import { Repository } from '../src/repository'
import { MemoryStore, RedisStore } from '../src/store'

const repo = (): Repository => new Repository(new MemoryStore())

describe('acquiring and releasing', () => {
  test('a free lock is taken, a held one is refused', async () => {
    const cache = repo()
    expect(await cache.lock('job').acquire()).toBe(true)
    expect(await cache.lock('job').acquire()).toBe(false)
  })

  test('releasing frees it for the next caller', async () => {
    const cache = repo()
    const held = cache.lock('job')
    await held.acquire()

    expect(await held.release()).toBe(true)
    expect(await cache.lock('job').acquire()).toBe(true)
  })

  /**
   * The reason this class exists. A holder whose TTL lapsed must NOT be able to
   * release: by then a peer may legitimately hold the lock, and an unconditional
   * delete would hand it to a third caller while the peer still believed it was
   * theirs. This exact bug existed in the scheduler's own mutex.
   */
  test('a holder that lost the lock cannot release the new owner\'s', async () => {
    const cache = repo()
    const stale = cache.lock('job', 1)
    await stale.acquire()

    await Bun.sleep(1100) // the TTL lapses; the work is still running

    const peer = cache.lock('job', 60)
    expect(await peer.acquire()).toBe(true)

    // The stale holder finishes and releases — it must be a no-op.
    expect(await stale.release()).toBe(false)
    // …so the peer still holds it.
    expect(await cache.lock('job', 60).acquire()).toBe(false)
  }, 5000)

  test('a non-owner release is refused', async () => {
    const cache = repo()
    await cache.lock('job').acquire()
    expect(await cache.lock('job').release()).toBe(false)
  })

  test('forceRelease ignores ownership', async () => {
    const cache = repo()
    await cache.lock('job').acquire()

    await cache.lock('job').forceRelease()
    expect(await cache.lock('job').acquire()).toBe(true)
  })

  test('each acquisition gets its own owner token', () => {
    const cache = repo()
    expect(cache.lock('a').owner()).not.toBe(cache.lock('a').owner())
  })
})

describe('the callback form releases for you', () => {
  test('it returns the callback result and frees the lock', async () => {
    const cache = repo()
    expect(await cache.lock('job').acquire(() => 'done')).toBe('done')
    expect(await cache.lock('job').acquire()).toBe(true)
  })

  test('a throwing callback still releases', async () => {
    const cache = repo()
    await expect(
      cache.lock('job').acquire(() => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    expect(await cache.lock('job').acquire()).toBe(true)
  })

  test('a contended lock returns false without running the callback', async () => {
    const cache = repo()
    await cache.lock('job').acquire()

    let ran = false
    const result = await cache.lock('job').acquire(() => {
      ran = true
      return 'ran'
    })

    expect(result).toBe(false)
    expect(ran).toBe(false)
  })

  test('an async callback is awaited before the release', async () => {
    const cache = repo()
    const order: string[] = []
    await cache.lock('job').acquire(async () => {
      await Bun.sleep(20)
      order.push('work')
    })
    order.push('after')
    expect(order).toEqual(['work', 'after'])
  })
})

describe('block waits for the lock', () => {
  test('it throws LockTimeoutError rather than returning a droppable false', async () => {
    const cache = repo()
    await cache.lock('job').acquire()

    await expect(cache.lock('job').block(0.2)).rejects.toBeInstanceOf(LockTimeoutError)
  }, 5000)

  test('it succeeds once the holder releases', async () => {
    const cache = repo()
    const held = cache.lock('job')
    await held.acquire()
    setTimeout(() => void held.release(), 100)

    expect(await cache.lock('job').block(3)).toBe(true)
  }, 6000)

  test('with a callback it returns the result and releases', async () => {
    const cache = repo()
    expect(await cache.lock('job').block(1, () => 'value')).toBe('value')
    expect(await cache.lock('job').acquire()).toBe(true)
  }, 5000)
})

describe('restoreLock hands ownership to another process', () => {
  test('a lock rebuilt from the owner token can release the original', async () => {
    const cache = repo()
    const original = cache.lock('job', 60)
    await original.acquire()

    // The token is what a queued job would carry in its payload.
    const restored = cache.restoreLock('job', original.owner(), 60)
    expect(await restored.release()).toBe(true)
    expect(await cache.lock('job').acquire()).toBe(true)
  })

  test('the wrong token cannot release', async () => {
    const cache = repo()
    await cache.lock('job', 60).acquire()
    expect(await cache.restoreLock('job', 'not-the-owner', 60).release()).toBe(false)
  })
})

/** Captured before any test removes it, so the prototype can be put back. */
const restoreForgetIf = MemoryStore.prototype.forgetIf

describe('guardrails', () => {
  test('a non-positive TTL is refused — a lock that never expires wedges forever', () => {
    const cache = repo()
    expect(() => cache.lock('job', 0)).toThrow(/positive TTL/)
    expect(() => cache.lock('job', -5)).toThrow()
  })

  test('a store without the atomic primitives says so instead of faking a lock', () => {
    // A store predating the lock primitives: `add` alone isn't enough, because
    // without an atomic compare-and-delete the lock could not be released safely.
    const crippled = new MemoryStore()
    Reflect.deleteProperty(Object.getPrototypeOf(crippled) as object, 'forgetIf')
    try {
      expect(supportsLocks(crippled)).toBe(false)
      expect(() => new Repository(crippled).lock('job')).toThrow(/cannot provide locks/)
    }
    finally {
      // Restore it for the other tests sharing this prototype.
      Object.defineProperty(Object.getPrototypeOf(crippled) as object, 'forgetIf', {
        value: restoreForgetIf,
        writable: true,
        configurable: true,
      })
    }
  })

  test('locks are namespaced, so they cannot collide with ordinary cache keys', async () => {
    const store = new MemoryStore()
    const cache = new Repository(store)
    await cache.lock('job').acquire()

    expect(await store.get('job')).toBeUndefined()
  })
})

/** Faithful on the one thing that matters: EVAL only deletes on an owner match. */
class FakeRedis implements RedisLike {
  private readonly values = new Map<string, string>()

  async send(command: string, args: string[]): Promise<unknown> {
    const key = args[0] as string
    switch (command) {
      case 'SET': {
        const [, value, ...rest] = args as string[]
        if (rest.includes('NX') && this.values.has(key))
          return null
        this.values.set(key, value as string)
        return 'OK'
      }
      case 'EVAL': {
        const target = args[2] as string
        const expected = args[3] as string
        if (this.values.get(target) !== expected)
          return 0
        this.values.delete(target)
        return 1
      }
      case 'DEL':
        return this.values.delete(key) ? 1 : 0
      default:
        return null
    }
  }
}

describe('the Redis store backs locks with an atomic compare-and-delete', () => {
  test('only the owner releases; a stale token is a no-op', async () => {
    const cache = new Repository(new RedisStore(new FakeRedis()))

    const holder = cache.lock('job', 60)
    expect(await holder.acquire()).toBe(true)
    expect(await cache.lock('job', 60).acquire()).toBe(false)

    // Someone else's token must not delete it.
    expect(await cache.restoreLock('job', 'someone-else', 60).release()).toBe(false)
    expect(await cache.lock('job', 60).acquire()).toBe(false)

    expect(await holder.release()).toBe(true)
    expect(await cache.lock('job', 60).acquire()).toBe(true)
  })
})

describe('Lock is usable directly against a store', () => {
  test('constructing it without the Repository works the same', async () => {
    const store = new MemoryStore()
    const lock = new Lock(store as never, 'direct', 30)
    expect(await lock.acquire()).toBe(true)
    expect(await lock.release()).toBe(true)
  })
})
