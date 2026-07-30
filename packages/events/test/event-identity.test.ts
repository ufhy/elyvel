import { describe, expect, test } from 'bun:test'
import { Dispatcher } from '../src/dispatcher'

/** Two unrelated modules each exporting a `Created` — a routine collision. */
function makeCreatedA(): new () => { a: number } {
  class Created {
    a = 1
  }
  return Created
}
function makeCreatedB(): new () => { b: number } {
  class Created {
    b = 2
  }
  return Created
}

/**
 * Regression: event identity was the SIMPLE class name, so two unrelated classes
 * called `Created` collapsed onto one listener list — listeners for one fired for
 * the other, with the wrong payload shape, and nothing said so. A minifying
 * bundler can also mangle distinct classes to the same short name.
 *
 * The name can't be an internal symbol: it's passed to every listener as its
 * second argument and travels to the queue as a string for queued listeners, so
 * it has to be stable and serializable. The fix is therefore to detect the clash
 * and require an explicit name, not to synthesize a hidden one.
 */
describe('two event classes cannot silently share an identity', () => {
  test('registering a second class under the same name throws', () => {
    const A = makeCreatedA()
    const B = makeCreatedB()
    const dispatcher = new Dispatcher()

    dispatcher.listen(A, () => {})
    expect(() => dispatcher.listen(B, () => {})).toThrow(/both identify as "Created"/)
  })

  test('the error names the escape hatch', () => {
    const dispatcher = new Dispatcher()
    dispatcher.listen(makeCreatedA(), () => {})
    expect(() => dispatcher.listen(makeCreatedB(), () => {})).toThrow(/static eventName/)
  })

  test('static eventName lets both coexist, each routed correctly', async () => {
    class Created {
      static eventName = 'billing.invoice.created'
      readonly kind = 'billing'
    }
    const Other = makeCreatedA()

    const hits: string[] = []
    const dispatcher = new Dispatcher()
    dispatcher.listen(Other, () => void hits.push('other'))
    dispatcher.listen(Created, () => void hits.push('billing'))

    await dispatcher.dispatch(new Created())
    expect(hits).toEqual(['billing'])

    await dispatcher.dispatch(new Other())
    expect(hits).toEqual(['billing', 'other'])
  })

  test('the declared name is what listeners receive and what queues would carry', async () => {
    class Created {
      static eventName = 'billing.invoice.created'
    }
    const seen: string[] = []
    const dispatcher = new Dispatcher()
    dispatcher.listen(Created, (_event: unknown, name: string) => void seen.push(name))

    await dispatcher.dispatch(new Created())
    expect(seen).toEqual(['billing.invoice.created'])
  })

  test('registering the SAME class twice is fine — that is just two listeners', async () => {
    const A = makeCreatedA()
    const hits: string[] = []
    const dispatcher = new Dispatcher()

    dispatcher.listen(A, () => void hits.push('one'))
    dispatcher.listen(A, () => void hits.push('two'))

    await dispatcher.dispatch(new A())
    expect(hits).toEqual(['one', 'two'])
  })

  test('an anonymous class cannot be identified and says so', () => {
    const Anon = (() => class {})()
    expect(() => new Dispatcher().listen(Anon, () => {})).toThrow(/anonymous event class/)
  })

  test('string names are unaffected — the caller owns that identity', async () => {
    const hits: string[] = []
    const dispatcher = new Dispatcher()
    dispatcher.listen('user.created', () => void hits.push('a'))
    dispatcher.listen('user.created', () => void hits.push('b'))

    await dispatcher.dispatch('user.created', {})
    expect(hits).toEqual(['a', 'b'])
  })

  test('forget releases the name for a different class', () => {
    const dispatcher = new Dispatcher()
    const A = makeCreatedA()
    dispatcher.listen(A, () => {})
    dispatcher.forget(A)
    expect(() => dispatcher.listen(makeCreatedB(), () => {})).not.toThrow()
  })
})
