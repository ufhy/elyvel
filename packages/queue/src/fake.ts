import type { Job } from './job'
import type { Dispatchable, DispatchOptions } from './manager'
import { QueueManager, setDefaultQueue } from './manager'

type JobClass = new (...args: never[]) => Job
type JobPredicate = (job: Job, options: DispatchOptions) => boolean

interface PushedRecord {
  job: Job | (() => void | Promise<void>)
  options: DispatchOptions
  /** true when it went through `dispatchSync` — ran-inline semantics. */
  sync: boolean
}

/**
 * A QueueManager that records instead of queueing — Laravel's `Queue::fake()` /
 * `Bus::fake()` (this framework has one dispatch path, so one fake covers both).
 *
 * `MemoryQueueStore` existed, but it tests the wrong thing: jobs pushed there
 * still run when a worker ticks, and asserting means popping records back off and
 * decoding payloads by hand. A fake answers the question a test actually asks —
 * "did this request dispatch that job, with these arguments?" — without running
 * anything.
 *
 * Nothing recorded here executes: `handle()` is never called, unique locks are
 * not taken, after-commit hooks do not fire.
 */
export class QueueFake extends QueueManager {
  readonly records: PushedRecord[] = []

  override async push(dispatchable: Dispatchable, options: DispatchOptions = {}): Promise<void> {
    this.records.push({ job: dispatchable, options, sync: false })
  }

  override async pushSync(dispatchable: Dispatchable): Promise<void> {
    this.records.push({ job: dispatchable, options: {}, sync: true })
  }

  /** Recorded jobs matching a class or predicate (closures excluded unless no filter). */
  pushed(match?: JobClass | JobPredicate): PushedRecord[] {
    if (!match)
      return [...this.records]
    return this.records.filter((r) => {
      // Closures have no class and no fields — they match no filter. Use
      // `assertClosurePushed()` for those.
      if (typeof r.job === 'function')
        return false
      return isJobClass(match) ? r.job instanceof match : match(r.job, r.options)
    })
  }

  /** Assert at least one matching job was dispatched. */
  assertPushed(match: JobClass | JobPredicate, callback?: JobPredicate): void {
    let hits = this.pushed(match)
    if (callback)
      hits = hits.filter(r => typeof r.job !== 'function' && callback(r.job as Job, r.options))
    if (hits.length === 0) {
      throw new Error(
        `Expected ${describe(match)} to have been dispatched, but it was not${this.summarise()}`,
      )
    }
  }

  assertPushedTimes(match: JobClass | JobPredicate, times: number): void {
    const count = this.pushed(match).length
    if (count !== times) {
      throw new Error(
        `Expected ${describe(match)} to have been dispatched ${times} time(s), but it was dispatched ${count} time(s).`,
      )
    }
  }

  /** Assert a job landed on a specific named queue (priority lane). */
  assertPushedOn(queue: string, match: JobClass | JobPredicate): void {
    const hits = this.pushed(match).filter(r => (r.options.queue ?? 'default') === queue)
    if (hits.length === 0) {
      throw new Error(
        `Expected ${describe(match)} to have been dispatched on queue "${queue}", but it was not.`,
      )
    }
  }

  assertNotPushed(match: JobClass | JobPredicate): void {
    if (this.pushed(match).length > 0)
      throw new Error(`Expected ${describe(match)} NOT to have been dispatched, but it was.`)
  }

  /** Assert a closure job was dispatched — they have no class to name. */
  assertClosurePushed(): void {
    if (!this.records.some(r => typeof r.job === 'function'))
      throw new Error('Expected a closure job to have been dispatched, but none was.')
  }

  assertNothingPushed(): void {
    if (this.records.length > 0) {
      throw new Error(
        `Expected no jobs to have been dispatched, but ${this.records.length} were${this.summarise()}`,
      )
    }
  }

  assertCount(count: number): void {
    if (this.records.length !== count) {
      throw new Error(
        `Expected ${count} job(s) to have been dispatched, but ${this.records.length} were.`,
      )
    }
  }

  private summarise(): string {
    if (this.records.length === 0)
      return '. Nothing was dispatched.'
    const names = this.records.slice(0, 8).map(r =>
      typeof r.job === 'function' ? '(closure)' : r.job.constructor.name,
    )
    return `. Dispatched: ${names.join(', ')}${this.records.length > 8 ? ', …' : ''}.`
  }
}

function isJobClass(value: JobClass | JobPredicate): value is JobClass {
  return typeof value === 'function' && typeof (value as JobClass).prototype?.handle === 'function'
}

function describe(match: JobClass | JobPredicate): string {
  return isJobClass(match) ? `[${match.name}]` : 'a matching job'
}

/**
 * Swap the default queue for a recording fake; returns it for assertions.
 *
 * ```ts
 * const queue = fakeQueue()
 * await placeOrder(cart)
 * queue.assertPushed(SendOrderConfirmation, job => job.orderId === cart.orderId)
 * queue.assertPushedOn('emails', SendOrderConfirmation)
 * ```
 */
export function fakeQueue(): QueueFake {
  const fake = new QueueFake()
  setDefaultQueue(fake)
  return fake
}

/** Restore a previously-captured real manager. */
export function restoreQueue(manager: QueueManager): void {
  setDefaultQueue(manager)
}
