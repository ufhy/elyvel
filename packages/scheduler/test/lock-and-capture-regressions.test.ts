import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { ScheduledEvent } from '../src/event'
import { configureScheduleMutex, MemoryScheduleMutex } from '../src/mutex'

afterEach(() => {
  configureScheduleMutex(new MemoryScheduleMutex())
})

/**
 * Regression: both locks key off `this.name`, and an un-named event falls back
 * to `event(<expression>)`. Two unnamed `.everyMinute()` callbacks therefore
 * shared ONE lock identity — with `withoutOverlapping` the second was skipped
 * for as long as the first ran, and with `onOneServer` only one of them ever
 * ran per tick while the other silently never did, every minute, forever.
 */
describe('an event locking on its name must have one', () => {
  test('withoutOverlapping on an unnamed event throws instead of colliding', async () => {
    const event = new ScheduledEvent(() => {}).everyMinute().withoutOverlapping()
    await expect(event.run(new Date())).rejects.toThrow(/needs a name to lock on/)
  })

  test('onOneServer on an unnamed event throws', async () => {
    const event = new ScheduledEvent(() => {}).everyMinute().onOneServer()
    await expect(event.run(new Date())).rejects.toThrow(/needs a name to lock on/)
  })

  test('a named event is fine, and an unnamed event without locks is fine', async () => {
    const named = new ScheduledEvent(() => {}).named('unique').everyMinute().withoutOverlapping()
    expect(await named.run(new Date())).toBe(true)

    const plain = new ScheduledEvent(() => {}).everyMinute()
    expect(await plain.run(new Date())).toBe(true)
  })
})

/**
 * Regression: the overlap lock was released unconditionally in `finally`. A task
 * running longer than its TTL let a peer acquire the freed key, and the original
 * holder then deleted the PEER's lock — so a third process could start alongside
 * the peer, which is exactly what withoutOverlapping promises cannot happen.
 */
describe('the overlap lock is released only by the acquisition that owns it', () => {
  test('an expired holder does not delete the lock a peer has since taken', async () => {
    const mutex = new MemoryScheduleMutex()
    configureScheduleMutex(mutex)

    // A holds the lock with a 1s TTL but takes longer than that.
    let release!: () => void
    const slow = new ScheduledEvent(
      () => new Promise<void>((resolve) => {
        release = resolve
      }),
    )
      .named('long-task')
      .everyMinute()
      .withoutOverlapping(1 / 60) // 1 second

    const aRun = slow.run(new Date())
    await Bun.sleep(5)

    // A's lock expires; a peer legitimately acquires the same key.
    await Bun.sleep(1050)
    expect(await mutex.create('overlap:long-task', 60, 'peer-token')).toBe(true)

    // A now finishes and runs its release. It must NOT delete the peer's lock.
    release()
    await aRun

    expect(await mutex.create('overlap:long-task', 60, 'third-token')).toBe(false)
  }, 10_000)

  test('a normal holder still releases its own lock', async () => {
    const mutex = new MemoryScheduleMutex()
    configureScheduleMutex(mutex)

    const event = new ScheduledEvent(() => {}).named('quick').everyMinute().withoutOverlapping()
    expect(await event.run(new Date())).toBe(true)

    // Released, so the next run acquires it again.
    expect(await event.run(new Date())).toBe(true)
  })
})

/**
 * Regression: the onOneServer bucket was always `floor(t / 60000)` with a
 * hardcoded 60s TTL, so `.everyTenSeconds().onOneServer()` — due 6× a minute —
 * only ever claimed once per minute, silently dropping 5 of every 6 runs.
 */
describe('the onOneServer bucket follows the event period', () => {
  test('a ten-second event claims once per ten-second bucket, not once per minute', async () => {
    configureScheduleMutex(new MemoryScheduleMutex())
    const ran: string[] = []
    const event = new ScheduledEvent(() => void ran.push('x'))
      .named('sub-minute')
      .everyTenSeconds()
      .onOneServer()

    expect(await event.run(new Date('2026-07-13T08:00:00Z'))).toBe(true)
    expect(await event.run(new Date('2026-07-13T08:00:10Z'))).toBe(true)
    expect(await event.run(new Date('2026-07-13T08:00:20Z'))).toBe(true)
    expect(ran).toHaveLength(3)
  })

  test('two servers still contend within the same bucket', async () => {
    configureScheduleMutex(new MemoryScheduleMutex())
    const tick = new Date('2026-07-13T08:00:00Z')
    const a = new ScheduledEvent(() => {}).named('shared').everyTenSeconds().onOneServer()
    const b = new ScheduledEvent(() => {}).named('shared').everyTenSeconds().onOneServer()

    expect(await a.run(tick)).toBe(true)
    expect(await b.run(tick)).toBe(false)
  })
})

/**
 * Regression: output capture swapped the four `console` methods on the GLOBAL
 * console around an `await`. With two capturing tasks overlapping, B saved A's
 * tee as "the original", A restored the real console, then B restored A's tee —
 * permanently corrupting `console` for the whole process. And unrelated
 * concurrent work in the same process had its output written into the task's
 * output file.
 */
describe('output capture is scoped to the task, not the process', () => {
  test('overlapping capturing tasks do not corrupt console or each other', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'elyvel-sched-'))
    const pristine = console.log

    const a = new ScheduledEvent(async () => {
      console.log('from-a-first')
      await Bun.sleep(30)
      console.log('from-a-second')
    })
      .named('task-a')
      .everyMinute()
      .sendOutputTo(join(dir, 'a.txt'))

    const b = new ScheduledEvent(async () => {
      await Bun.sleep(10)
      console.log('from-b')
    })
      .named('task-b')
      .everyMinute()
      .sendOutputTo(join(dir, 'b.txt'))

    await Promise.all([a.run(new Date()), b.run(new Date())])

    // The real console is back — not the other task's tee.
    expect(console.log).toBe(pristine)

    const aOut = await Bun.file(join(dir, 'a.txt')).text()
    const bOut = await Bun.file(join(dir, 'b.txt')).text()
    expect(aOut).toContain('from-a-first')
    expect(aOut).toContain('from-a-second')
    expect(aOut).not.toContain('from-b')
    expect(bOut).toContain('from-b')
    expect(bOut).not.toContain('from-a')
  })

  test('console output from unrelated concurrent work is not captured', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'elyvel-sched-'))

    const event = new ScheduledEvent(async () => {
      console.log('task-output')
      await Bun.sleep(20)
    })
      .named('capturing')
      .everyMinute()
      .sendOutputTo(join(dir, 'out.txt'))

    const run = event.run(new Date())
    await Bun.sleep(5)
    console.log('unrelated-request-log') // e.g. an HTTP handler under schedule:work
    await run

    const out = await Bun.file(join(dir, 'out.txt')).text()
    expect(out).toContain('task-output')
    expect(out).not.toContain('unrelated-request-log')
  })
})
