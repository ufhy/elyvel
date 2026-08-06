import { afterEach, describe, expect, test } from 'bun:test'
import { fakeQueue, restoreQueue } from '../src/fake'
import { Job } from '../src/job'
import { dispatch, dispatchSync, QueueManager } from '../src/manager'

let handled = 0

class SendOrderConfirmation extends Job {
  constructor(readonly orderId: number) {
    super()
  }

  async handle(): Promise<void> {
    handled++
  }
}

class GenerateReport extends Job {
  async handle(): Promise<void> {
    handled++
  }
}

afterEach(() => {
  restoreQueue(new QueueManager())
  handled = 0
})

/**
 * Laravel's `Queue::fake()` / `Bus::fake()` — one dispatch path here, one fake.
 * `MemoryQueueStore` tests the wrong thing: jobs pushed there still run when a
 * worker ticks, and asserting means decoding queue payloads by hand.
 */
describe('fakeQueue', () => {
  test('records a dispatch without running the job', async () => {
    const queue = fakeQueue()
    await dispatch(new SendOrderConfirmation(42))

    queue.assertPushed(SendOrderConfirmation)
    queue.assertCount(1)
    expect(handled).toBe(0) // handle() must never run under the fake
  })

  test('a predicate sees the job instance with its fields', async () => {
    const queue = fakeQueue()
    await dispatch(new SendOrderConfirmation(42))

    queue.assertPushed(SendOrderConfirmation, job => (job as SendOrderConfirmation).orderId === 42)
    expect(() => queue.assertPushed(SendOrderConfirmation, job => (job as SendOrderConfirmation).orderId === 7))
      .toThrow()
  })

  test('assertPushedOn checks the named queue lane', async () => {
    const queue = fakeQueue()
    await dispatch(new SendOrderConfirmation(1), { queue: 'emails' })

    queue.assertPushedOn('emails', SendOrderConfirmation)
    expect(() => queue.assertPushedOn('default', SendOrderConfirmation)).toThrow(/queue "default"/)
  })

  test('dispatchSync is recorded, and still does not run', async () => {
    const queue = fakeQueue()
    await dispatchSync(new GenerateReport())

    queue.assertPushed(GenerateReport)
    expect(handled).toBe(0)
  })

  test('closures are recorded and asserted separately — they have no class', async () => {
    const queue = fakeQueue()
    await dispatch(() => {
      handled++
    })

    queue.assertClosurePushed()
    queue.assertNotPushed(GenerateReport)
    expect(handled).toBe(0)
  })

  test('a failed assertion names what WAS dispatched', async () => {
    const queue = fakeQueue()
    await dispatch(new GenerateReport())

    expect(() => queue.assertPushed(SendOrderConfirmation))
      .toThrow(/Dispatched: GenerateReport/)
  })

  test('assertNothingPushed / assertNotPushed', async () => {
    const queue = fakeQueue()
    queue.assertNothingPushed()
    queue.assertNotPushed(GenerateReport)

    await dispatch(new GenerateReport())
    expect(() => queue.assertNothingPushed()).toThrow(/1 were/)
    expect(() => queue.assertNotPushed(GenerateReport)).toThrow(/NOT to have been dispatched/)
  })

  test('assertPushedTimes counts per class', async () => {
    const queue = fakeQueue()
    await dispatch(new SendOrderConfirmation(1))
    await dispatch(new SendOrderConfirmation(2))
    await dispatch(new GenerateReport())

    queue.assertPushedTimes(SendOrderConfirmation, 2)
    queue.assertPushedTimes(GenerateReport, 1)
  })
})
