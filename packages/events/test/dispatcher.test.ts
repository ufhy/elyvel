import { describe, expect, test } from 'bun:test'
import {
  Dispatcher,
  EventFake,
  type Subscriber,
  configureEventAfterCommit,
  fakeEvents,
  restoreEvents,
} from '../src/dispatcher'

class UserRegistered {
  constructor(readonly email: string) {}
}

describe('Dispatcher', () => {
  test('listen by class + dispatch instance (typed)', async () => {
    const d = new Dispatcher()
    const seen: string[] = []
    d.listen(UserRegistered, (e) => seen.push(e.email))
    d.listen(UserRegistered, (e) => seen.push(`welcome:${e.email}`))
    await d.dispatch(new UserRegistered('ada@x.io'))
    expect(seen).toEqual(['ada@x.io', 'welcome:ada@x.io'])
  })

  test('listen by string name + payload', async () => {
    const d = new Dispatcher()
    let got: unknown
    d.listen('cache.cleared', (payload) => {
      got = payload
    })
    await d.dispatch('cache.cleared', { store: 'redis' })
    expect(got).toEqual({ store: 'redis' })
  })

  test('class listener with handle()', async () => {
    const d = new Dispatcher()
    const calls: string[] = []
    const listener = {
      handle(e: UserRegistered) {
        calls.push(e.email)
      },
    }
    d.listen(UserRegistered, listener)
    await d.dispatch(new UserRegistered('x@y.io'))
    expect(calls).toEqual(['x@y.io'])
  })

  test('wildcard listener fires for every event with its name', async () => {
    const d = new Dispatcher()
    const names: string[] = []
    d.listen('*', (_e, name) => names.push(name))
    await d.dispatch(new UserRegistered('a@b.io'))
    await d.dispatch('custom.thing')
    expect(names).toEqual(['UserRegistered', 'custom.thing'])
  })

  test('dispatch collects non-null results; until stops at first non-null', async () => {
    const d = new Dispatcher()
    d.listen('calc', () => null)
    d.listen('calc', () => 2)
    d.listen('calc', () => 3)
    expect(await d.dispatch('calc')).toEqual([2, 3]) // nulls filtered

    class Compute {}
    const d2 = new Dispatcher()
    d2.listen(Compute, () => null)
    d2.listen(Compute, () => 'first')
    d2.listen(Compute, () => 'second')
    expect(await d2.until(new Compute())).toBe('first') // stops at first non-null
  })

  test('hasListeners / forget', async () => {
    const d = new Dispatcher()
    d.listen('e', () => {})
    expect(d.hasListeners('e')).toBe(true)
    d.forget('e')
    expect(d.hasListeners('e')).toBe(false)
  })

  test('subscriber registers its own mappings', async () => {
    const d = new Dispatcher()
    const hits: string[] = []
    const sub: Subscriber = {
      subscribe(dispatcher) {
        dispatcher.listen('a', () => hits.push('a'))
        dispatcher.listen('b', () => hits.push('b'))
      },
    }
    d.subscribe(sub)
    await d.dispatch('a')
    await d.dispatch('b')
    expect(hits).toEqual(['a', 'b'])
  })

  test('returning false halts propagation', async () => {
    const d = new Dispatcher()
    const hits: string[] = []
    d.listen('e', () => hits.push('first'))
    d.listen('e', () => false) // stop
    d.listen('e', () => hits.push('third'))
    await d.dispatch('e')
    expect(hits).toEqual(['first'])
  })

  test('push / flush deferred events', async () => {
    const d = new Dispatcher()
    const seen: unknown[] = []
    d.listen('report', (p) => seen.push(p))
    d.push('report', { id: 1 })
    d.push('report', { id: 2 })
    expect(seen).toEqual([]) // nothing yet
    await d.flush('report')
    expect(seen).toEqual([{ id: 1 }, { id: 2 }])
  })

  test('ShouldDispatchAfterCommit defers via the hook', async () => {
    const deferred: Array<() => void> = []
    configureEventAfterCommit((cb) => deferred.push(cb))
    const d = new Dispatcher()
    const seen: string[] = []
    d.listen('Paid', () => seen.push('ran'))
    await d.dispatch('Paid', { dispatchAfterCommit: true })
    expect(seen).toEqual([]) // not run until "commit"
    for (const cb of deferred) cb()
    await new Promise((r) => setTimeout(r, 0))
    expect(seen).toEqual(['ran'])
    configureEventAfterCommit(() => {}) // reset
  })
})

describe('Event faking', () => {
  class OrderPlaced {
    constructor(readonly id: number) {}
  }

  test('fakeEvents records instead of running; asserts', async () => {
    const fake = fakeEvents()
    expect(fake).toBeInstanceOf(EventFake)
    let ran = false
    fake.listen(OrderPlaced, () => {
      ran = true
    })
    await fake.dispatch(new OrderPlaced(1))
    await fake.dispatch(new OrderPlaced(2))

    expect(ran).toBe(false) // listeners NOT invoked under fake
    fake.assertDispatched(OrderPlaced)
    fake.assertDispatched(OrderPlaced, 2)
    expect(fake.dispatched(OrderPlaced)).toHaveLength(2)
    expect(() => fake.assertNotDispatched(OrderPlaced)).toThrow()

    restoreEvents(new Dispatcher())
  })
})
