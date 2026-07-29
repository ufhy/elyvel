import { describe, expect, test } from 'bun:test'
import { Dispatcher } from '../src/dispatcher'

/**
 * Regression: `flush()` did `pushed.delete(name)` BEFORE the dispatch loop, so
 * if payload #1's listener threw, payloads #2..N were already gone from the map
 * — never dispatched, and unrecoverable even by calling `flush()` again.
 */
describe('flush does not discard payloads it has not dispatched yet', () => {
  test('a throwing listener leaves the remaining payloads recoverable', async () => {
    const seen: number[] = []
    const dispatcher = new Dispatcher()
    dispatcher.listen('report', (payload: any) => {
      if (payload.n === 1)
        throw new Error('boom')
      seen.push(payload.n)
    })

    dispatcher.push('report', { n: 1 })
    dispatcher.push('report', { n: 2 })
    dispatcher.push('report', { n: 3 })

    await expect(dispatcher.flush('report')).rejects.toThrow('boom')
    expect(seen).toEqual([]) // #1 threw, so nothing got through yet

    // #2 and #3 are still queued rather than silently lost.
    const healthy = new Dispatcher()
    healthy.listen('report', (payload: any) => {
      seen.push(payload.n)
    })
    // Same dispatcher, listener now tolerant: re-flushing delivers the rest.
    dispatcher.forget('report')
    dispatcher.listen('report', (payload: any) => {
      seen.push(payload.n)
    })
    await dispatcher.flush('report')
    expect(seen).toEqual([1, 2, 3])
  })

  test('a clean flush still dispatches everything and empties the queue', async () => {
    const seen: number[] = []
    const dispatcher = new Dispatcher()
    dispatcher.listen('ok', (payload: any) => {
      seen.push(payload.n)
    })
    dispatcher.push('ok', { n: 1 })
    dispatcher.push('ok', { n: 2 })

    await dispatcher.flush('ok')
    expect(seen).toEqual([1, 2])

    await dispatcher.flush('ok') // nothing left
    expect(seen).toEqual([1, 2])
  })
})
