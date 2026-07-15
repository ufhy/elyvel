import { afterEach, describe, expect, test } from 'bun:test'
import { Dispatcher } from '../src/dispatcher'
import { configureListenerQueuer, isQueuedListener, QueuedListener } from '../src/queued-listener'

class OrderShipped {
  constructor(public priority = false) {}
}

// reset the module-level queuer after each test
afterEach(() => configureListenerQueuer(null as never))

describe('QueuedListener detection', () => {
  test('isQueuedListener distinguishes queued listeners from plain ones', () => {
    class L extends QueuedListener<OrderShipped> {
      handle() {}
    }
    expect(isQueuedListener(new L())).toBe(true)
    expect(isQueuedListener({ handle() {} })).toBe(false)
    expect(isQueuedListener(() => {})).toBe(false)
  })
})

describe('dispatcher + queued listeners', () => {
  test('pushes to the queuer instead of running inline', async () => {
    let ran = false
    const queued: OrderShipped[] = []
    class Send extends QueuedListener<OrderShipped> {
      handle(event: OrderShipped) {
        ran = true
        return event
      }
    }
    configureListenerQueuer((_l, event) => void queued.push(event as OrderShipped))
    const d = new Dispatcher()
    d.listen(OrderShipped, new Send())

    const event = new OrderShipped()
    await d.dispatch(event)
    expect(ran).toBe(false) // NOT run inline
    expect(queued).toEqual([event]) // pushed to the queue
  })

  test('shouldQueue(event) === false runs inline instead', async () => {
    let ran = false
    class Send extends QueuedListener<OrderShipped> {
      handle() {
        ran = true
      }
      shouldQueue = (e: OrderShipped) => e.priority // false unless priority
    }
    configureListenerQueuer(() => {
      throw new Error('should not queue')
    })
    const d = new Dispatcher()
    d.listen(OrderShipped, new Send())
    await d.dispatch(new OrderShipped(false))
    expect(ran).toBe(true) // ran inline because shouldQueue returned false
  })

  test('with no queuer configured, runs inline (fallback)', async () => {
    let ran = false
    class Send extends QueuedListener<OrderShipped> {
      handle() {
        ran = true
      }
    }
    const d = new Dispatcher()
    d.listen(OrderShipped, new Send())
    await d.dispatch(new OrderShipped())
    expect(ran).toBe(true)
  })
})
