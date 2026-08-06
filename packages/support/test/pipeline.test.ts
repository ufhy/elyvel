import { describe, expect, test } from 'bun:test'
import { Pipeline } from '../src/pipeline'

/**
 * Laravel's Pipeline — the onion middleware is made of, standalone. A stage
 * wraps everything after it: act on the way in and out, short-circuit, or
 * try/finally around the rest of the chain.
 */
describe('Pipeline', () => {
  test('stages run in order, destination last', async () => {
    const result = await Pipeline.send('x')
      .through([
        async (v, next) => next(`${v}a`),
        async (v, next) => next(`${v}b`),
      ])
      .then(v => `${v}!`)
    expect(result).toBe('xab!')
  })

  test('the first pipe is outermost — it sees the value first in, last out', async () => {
    const order: string[] = []
    await Pipeline.send(0)
      .through([
        async (v, next) => {
          order.push('one:in')
          const out = await next(v)
          order.push('one:out')
          return out
        },
        async (v, next) => {
          order.push('two:in')
          const out = await next(v)
          order.push('two:out')
          return out
        },
      ])
      .thenReturn()
    expect(order).toEqual(['one:in', 'two:in', 'two:out', 'one:out'])
  })

  test('a stage short-circuits by not calling next', async () => {
    let reached = false
    const result = await Pipeline.send({ blocked: true })
      .through([
        async (v, next) => (v.blocked ? { ...v, reason: 'blocked' } : next(v)),
        async (v, next) => {
          reached = true
          return next(v)
        },
      ])
      .thenReturn()
    expect(result).toMatchObject({ reason: 'blocked' })
    expect(reached).toBe(false)
  })

  test('object pipes with handle() work — a class instance is a pipe', async () => {
    class AddTax {
      constructor(private readonly rate: number) {}
      async handle(total: number, next: (v: number) => Promise<number>): Promise<number> {
        return next(total * (1 + this.rate))
      }
    }
    const result = await Pipeline.send(100).through([new AddTax(0.1)]).thenReturn()
    expect(result).toBeCloseTo(110)
  })

  test('pipe() appends conditionally', async () => {
    const pipeline = Pipeline.send(1).through([async (v, next) => next(v + 1)])
    pipeline.pipe(async (v, next) => next(v * 10))
    expect(await pipeline.thenReturn()).toBe(20)
  })

  test('a throwing stage rejects the whole run', async () => {
    const run = Pipeline.send('x')
      .through([
        async () => {
          throw new Error('stage failed')
        },
      ])
      .thenReturn()
    expect(run).rejects.toThrow('stage failed')
  })

  test('an empty chain goes straight to the destination', async () => {
    expect(await Pipeline.send(5).through([]).then(v => v * 2)).toBe(10)
  })

  test('then() may change the type', async () => {
    const length = await Pipeline.send('hello').through([async (v, next) => next(v.toUpperCase())]).then(v => v.length)
    expect(length).toBe(5)
  })
})
