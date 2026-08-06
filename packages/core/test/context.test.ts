import type { LogEntry, Transport } from '../src/logger'
import { describe, expect, test } from 'bun:test'
import { beginContextScope, Context, withContextScope } from '../src/context'
import { Logger } from '../src/logger'

/**
 * Laravel's `Context`: request-scoped values that ride the async continuation,
 * land on every log entry, and travel with queued jobs. The problem is
 * correlation — a request logs in six places across four modules, and the call
 * site that wasn't handed the trace id is always the one you needed.
 */
describe('Context', () => {
  test('add/get/has/forget inside a scope', () => {
    withContextScope(() => {
      Context.add('trace_id', 'abc')
      expect(Context.get<string>('trace_id')).toBe('abc')
      expect(Context.has('trace_id')).toBe(true)
      Context.forget('trace_id')
      expect(Context.has('trace_id')).toBe(false)
    })
  })

  test('add() with a record sets several at once; only() picks a subset', () => {
    withContextScope(() => {
      Context.add({ a: 1, b: 2, c: 3 })
      expect(Context.only(['a', 'c', 'missing'])).toEqual({ a: 1, c: 3 })
      expect(Context.all()).toEqual({ a: 1, b: 2, c: 3 })
    })
  })

  test('addIf only fills a gap', () => {
    withContextScope(() => {
      Context.add('key', 'first')
      Context.addIf('key', 'second')
      expect(Context.get<string>('key')).toBe('first')
    })
  })

  test('push builds a stack; increment counts', () => {
    withContextScope(() => {
      Context.push('breadcrumbs', 'auth')
      Context.push('breadcrumbs', 'billing', 'charge')
      expect(Context.get<string[]>('breadcrumbs')).toEqual(['auth', 'billing', 'charge'])
      Context.increment('records')
      Context.increment('records', 4)
      expect(Context.get<number>('records')).toBe(5)
      Context.decrement('records')
      expect(Context.get<number>('records')).toBe(4)
    })
  })

  /** The isolation is the point: two concurrent requests must never share a box. */
  test('concurrent scopes are isolated', async () => {
    const seen: (string | undefined)[] = []
    await Promise.all([
      withContextScope(async () => {
        Context.add('who', 'first')
        await Bun.sleep(20)
        seen.push(Context.get<string>('who'))
      }),
      withContextScope(async () => {
        Context.add('who', 'second')
        await Bun.sleep(5)
        seen.push(Context.get<string>('who'))
      }),
    ])
    expect(seen.sort()).toEqual(['first', 'second'])
  })

  test('outside any scope, reads are empty and writes do not crash', () => {
    expect(Context.get('anything')).toBeUndefined()
    expect(Context.all()).toEqual({})
    expect(() => Context.add('orphan', 1)).not.toThrow()
  })

  test('log entries carry the visible context automatically', () => {
    const entries: LogEntry[] = []
    const transport: Transport = { log: e => void entries.push(e) }
    const log = new Logger({ level: 'info', transports: [transport] })

    withContextScope(() => {
      Context.add('trace_id', 'xyz')
      log.info('charged', { amount: 100 })
    })

    expect(entries[0]?.context).toMatchObject({ trace_id: 'xyz', amount: 100 })
  })

  test('the call site wins a key collision with the context', () => {
    const entries: LogEntry[] = []
    const log = new Logger({ level: 'info', transports: [{ log: e => void entries.push(e) }] })
    withContextScope(() => {
      Context.add('source', 'context')
      log.info('m', { source: 'call-site' })
    })
    expect(entries[0]?.context?.source).toBe('call-site')
  })

  /** Hidden values travel with dehydrate() but never reach a log entry. */
  test('hidden context is logged never, dehydrated always', () => {
    const entries: LogEntry[] = []
    const log = new Logger({ level: 'info', transports: [{ log: e => void entries.push(e) }] })

    withContextScope(() => {
      Context.add('trace_id', 't')
      Context.addHidden('api_token', 'secret-token')
      log.info('m')

      expect(Context.getHidden<string>('api_token')).toBe('secret-token')
      const dehydrated = Context.dehydrate()
      expect(dehydrated.hidden.api_token).toBe('secret-token')
      expect(dehydrated.data.trace_id).toBe('t')
    })

    expect(JSON.stringify(entries[0])).not.toContain('secret-token')
  })

  test('hydrate restores a captured context into a fresh scope', () => {
    let captured!: ReturnType<typeof Context.dehydrate>
    withContextScope(() => {
      Context.add('trace_id', 'from-request')
      Context.addHidden('token', 'k')
      captured = Context.dehydrate()
    })

    withContextScope(() => {
      expect(Context.get('trace_id')).toBeUndefined() // fresh scope
      Context.hydrate(captured)
      expect(Context.get<string>('trace_id')).toBe('from-request')
      expect(Context.getHidden<string>('token')).toBe('k')
    })
  })

  test('beginContextScope opens a scope for the current continuation', () => {
    beginContextScope()
    Context.add('in-scope', true)
    expect(Context.get<boolean>('in-scope')).toBe(true)
  })
})
