import type { RedisLike } from '../src/store'
import { describe, expect, test } from 'bun:test'
import { RedisQueueStore } from '../src/store'

/**
 * Logic-only Redis fake, faithful on the one detail that matters here: `ZREM`
 * reports how many members it ACTUALLY removed, so a second remover gets 0.
 */
class FakeRedis implements RedisLike {
  private readonly sets = new Map<string, Set<string>>()

  async send(command: string, args: string[]): Promise<unknown> {
    const key = args[0] as string
    const set = this.sets.get(key) ?? new Set<string>()
    switch (command) {
      case 'ZADD':
        set.add((args[3] ?? args[2]) as string)
        this.sets.set(key, set)
        return 1
      case 'ZRANGEBYSCORE':
        return [...set].slice(0, 1)
      case 'ZREM':
        return set.delete(args[1] as string) ? 1 : 0
      case 'ZCARD':
        return set.size
      default:
        return null
    }
  }
}

// Regression: `pop()` read the next member and removed it in two separate
// commands, then returned the job regardless of whether its own `ZREM` had
// actually removed anything. Workers poll the same Redis queue from separate
// processes — that's the normal deployment — so both claimed the SAME job and
// both ran it. Anything non-idempotent (charging a card, sending an email)
// happened twice.
describe('RedisQueueStore.pop claims a job exclusively', () => {
  test('one job, two concurrent workers — exactly one claims it', async () => {
    const store = new RedisQueueStore(new FakeRedis())
    await store.push('{"job":"ChargeCard"}', {})

    const claimed = (await Promise.all([store.pop(), store.pop()])).filter(Boolean)
    expect(claimed).toHaveLength(1)
    expect(await store.size()).toBe(0)
  })

  test('one job, more workers than jobs — the losers get null, not a hang', async () => {
    const store = new RedisQueueStore(new FakeRedis())
    await store.push('{"job":"Only"}', {})

    const results = await Promise.all([store.pop(), store.pop(), store.pop()])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(results.filter(r => r === null)).toHaveLength(2)
  })

  test('several jobs and workers — each gets a distinct job, none lost', async () => {
    // The retry-on-lost-race must not make a worker give up early or
    // double-claim: every queued job should be taken exactly once.
    const store = new RedisQueueStore(new FakeRedis())
    for (const n of [1, 2, 3]) await store.push(`{"job":"J${n}"}`, {})

    const ids = (await Promise.all([store.pop(), store.pop(), store.pop()]))
      .filter(Boolean)
      .map(record => record!.id)

    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3) // all distinct
    expect(await store.size()).toBe(0)
  })
})
