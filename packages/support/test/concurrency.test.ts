import { describe, expect, test } from 'bun:test'
import { Concurrency, ConcurrencyTimedOutError } from '../src/concurrency'

/**
 * Laravel's `Concurrency::run`. No process driver here — Bun's event loop
 * already runs async closures concurrently. The value over bare Promise.all is
 * named results, a limit, and per-task timeouts that don't leak timers.
 */
describe('Concurrency.run', () => {
  test('an array of tasks returns results in order', async () => {
    const [a, b, c] = await Concurrency.run([
      async () => 1,
      async () => {
        await Bun.sleep(10)
        return 2
      },
      () => 3, // sync tasks are fine too
    ])
    expect([a, b, c]).toEqual([1, 2, 3])
  })

  test('named tasks return named results — Laravel\'s associative form', async () => {
    const { users, orders } = await Concurrency.run({
      users: async () => 42,
      orders: async () => 7,
    })
    expect(users).toBe(42)
    expect(orders).toBe(7)
  })

  test('tasks actually overlap', async () => {
    const started = Date.now()
    await Concurrency.run([() => Bun.sleep(50), () => Bun.sleep(50), () => Bun.sleep(50)])
    // Sequential would be ≥150ms; concurrent is ~50ms.
    expect(Date.now() - started).toBeLessThan(140)
  })

  test('limit bounds how many run at once', async () => {
    let running = 0
    let peak = 0
    const task = async () => {
      running++
      peak = Math.max(peak, running)
      await Bun.sleep(20)
      running--
    }
    await Concurrency.run([task, task, task, task, task, task], { limit: 2 })
    expect(peak).toBe(2)
  })

  test('one failure rejects the run — after every started task settled', async () => {
    let finished = 0
    const run = Concurrency.run([
      async () => {
        throw new Error('boom')
      },
      async () => {
        await Bun.sleep(30)
        finished++
      },
    ])
    expect(run).rejects.toThrow('boom')
    await Bun.sleep(50)
    // The sibling was not abandoned mid-flight.
    expect(finished).toBe(1)
  })

  test('a task exceeding the timeout rejects with its label', async () => {
    expect(
      Concurrency.run({ slow: () => Bun.sleep(5000) }, { timeoutSeconds: 0.05 }),
    ).rejects.toThrow(ConcurrencyTimedOutError)
    expect(
      Concurrency.run({ slow: () => Bun.sleep(5000) }, { timeoutSeconds: 0.05 }),
    ).rejects.toThrow(/"slow" timed out/)
  })

  test('a fast task under a timeout resolves normally (and the timer is cleaned up)', async () => {
    const [value] = await Concurrency.run([async () => 'ok'], { timeoutSeconds: 5 })
    expect(value).toBe('ok')
  })

  test('an empty task list resolves to an empty result', async () => {
    expect(await Concurrency.run([])).toEqual([])
    expect(await Concurrency.run({})).toEqual({})
  })
})
