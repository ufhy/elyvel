import { describe, expect, test } from 'bun:test'
import {
  configureEventAfterCommit,
  configureEventFailureLogger,
  Dispatcher,
} from '../src/dispatcher'

class OrderShipped {
  /** Instance field, not static — that's what `shouldDispatchAfterCommit` reads. */
  readonly dispatchAfterCommit = true
  constructor(public id: number) {}
}

/**
 * Regression: `afterCommitHook(() => { void this.run(name, value) })`. Nothing
 * awaits it — the DB layer's callback returns void, and `dispatch()` has already
 * returned `[]` — so a throwing after-commit listener became a bare unhandled
 * rejection: no logger, no failure hook, and no way for the caller to know the
 * event never reached its listeners.
 */
describe('an after-commit listener failure is reported, not swallowed', () => {
  test('a throwing listener reaches the configured failure logger', async () => {
    const failures: { name: string, error: unknown }[] = []
    configureEventFailureLogger((name, error) => void failures.push({ name, error }))
    // Run the deferred callback immediately, as a committed transaction would.
    configureEventAfterCommit(callback => void callback())

    try {
      const dispatcher = new Dispatcher()
      dispatcher.listen(OrderShipped, () => {
        throw new Error('listener exploded')
      })

      // `dispatch` itself resolves (the event is deferred, not awaited).
      await dispatcher.dispatch(new OrderShipped(1))
      await Bun.sleep(5)

      expect(failures).toHaveLength(1)
      expect(failures[0]!.name).toBe('OrderShipped')
      expect((failures[0]!.error as Error).message).toBe('listener exploded')
    }
    finally {
      configureEventFailureLogger(null)
      configureEventAfterCommit(null)
    }
  })

  test('a successful after-commit listener reports nothing', async () => {
    const failures: unknown[] = []
    const seen: number[] = []
    configureEventFailureLogger((_name, error) => void failures.push(error))
    configureEventAfterCommit(callback => void callback())

    try {
      const dispatcher = new Dispatcher()
      dispatcher.listen(OrderShipped, (e: OrderShipped) => void seen.push(e.id))

      await dispatcher.dispatch(new OrderShipped(7))
      await Bun.sleep(5)

      expect(seen).toEqual([7])
      expect(failures).toEqual([])
    }
    finally {
      configureEventFailureLogger(null)
      configureEventAfterCommit(null)
    }
  })
})
