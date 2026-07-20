import type { LogEntry, Transport } from '../src/logger'
import { describe, expect, test } from 'bun:test'
import { Logger, REDACT_PATTERNS } from '../src/logger'

class Capture implements Transport {
  entries: LogEntry[] = []
  log(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

describe('redaction', () => {
  test('masks sensitive keys, case-insensitively and recursively', () => {
    const cap = new Capture()
    const log = new Logger({ level: 'info', transports: [cap] })
    log.info('signup', {
      email: 'a@b.com',
      Password: 'hunter2',
      nested: { token: 'abc', keep: 1 },
      list: [{ authorization: 'Bearer x' }],
    })

    const ctx = cap.entries[0]!.context as Record<string, any>
    expect(ctx.email).toBe('a@b.com')
    expect(ctx.Password).toBe('[REDACTED]')
    expect(ctx.nested.token).toBe('[REDACTED]')
    expect(ctx.nested.keep).toBe(1)
    expect(ctx.list[0].authorization).toBe('[REDACTED]')
  })

  test('custom redact list overrides the default', () => {
    const cap = new Capture()
    const log = new Logger({ level: 'info', transports: [cap], redact: ['ssn'] })
    log.info('x', { ssn: '123', password: 'not-masked-now' })

    const ctx = cap.entries[0]!.context as Record<string, any>
    expect(ctx.ssn).toBe('[REDACTED]')
    expect(ctx.password).toBe('not-masked-now')
  })

  test('pattern redaction masks matches inside string values', () => {
    const cap = new Capture()
    const log = new Logger({
      level: 'info',
      transports: [cap],
      redactPatterns: [REDACT_PATTERNS.bearer, REDACT_PATTERNS.creditCard],
    })
    log.info('req', {
      header: 'Bearer abc.def.ghi',
      note: 'card 4111 1111 1111 1111 on file',
    })

    const ctx = cap.entries[0]!.context as Record<string, any>
    expect(ctx.header).toBe('[REDACTED]')
    expect(ctx.note).toContain('[REDACTED]')
    expect(ctx.note).not.toContain('4111')
  })

  test('redactJson masks sensitive keys inside stringified JSON', () => {
    const cap = new Capture()
    const log = new Logger({ level: 'info', transports: [cap], redactJson: true })
    log.info('webhook', { payload: JSON.stringify({ user: 'ada', password: 'hunter2' }) })

    const payload = (cap.entries[0]!.context as Record<string, any>).payload as string
    const parsed = JSON.parse(payload)
    expect(parsed.password).toBe('[REDACTED]')
    expect(parsed.user).toBe('ada')
  })

  test('redactJson leaves non-JSON strings untouched', () => {
    const cap = new Capture()
    const log = new Logger({ level: 'info', transports: [cap], redactJson: true })
    log.info('x', { note: 'just a plain sentence' })
    expect((cap.entries[0]!.context as Record<string, any>).note).toBe('just a plain sentence')
  })

  test('descends into class instances, not just plain object literals', () => {
    // e.g. an ORM model instance passed straight into log context — its own
    // enumerable fields (constructor-assigned, exactly where `password`/
    // `token` would live) must still be redacted, not dumped unredacted.
    class UserModel {
      email = 'a@b.com'
      password = 'hunter2'
    }
    const cap = new Capture()
    const log = new Logger({ level: 'info', transports: [cap] })
    log.info('signup', { user: new UserModel() })

    const ctx = cap.entries[0]!.context as Record<string, any>
    expect(ctx.user.email).toBe('a@b.com')
    expect(ctx.user.password).toBe('[REDACTED]')
  })

  test('does not mangle Date/RegExp/Map/Set/Error values', () => {
    const cap = new Capture()
    const log = new Logger({ level: 'info', transports: [cap] })
    const date = new Date('2026-01-01T00:00:00.000Z')
    const error = new Error('boom')
    const pattern = /abc/
    log.info('x', { date, pattern, map: new Map([['a', 1]]), set: new Set([1, 2]), error })

    const ctx = cap.entries[0]!.context as Record<string, any>
    expect(ctx.date).toBe(date) // not flattened to `{}`
    expect(ctx.pattern).toBe(pattern)
    expect(ctx.map.get('a')).toBe(1)
    expect(ctx.set.has(2)).toBe(true)
    expect(ctx.error).toBe(error)
  })
})

describe('bindings', () => {
  test('withBindings merges context into every entry', () => {
    const cap = new Capture()
    const log = new Logger({ level: 'info', transports: [cap] }).withBindings({ requestId: 'r-1' })
    log.info('a', { x: 1 })
    log.info('b')

    expect(cap.entries[0]!.context).toMatchObject({ requestId: 'r-1', x: 1 })
    expect(cap.entries[1]?.context).toMatchObject({ requestId: 'r-1' })
  })

  test('call context overrides a binding of the same key', () => {
    const cap = new Capture()
    const log = new Logger({ level: 'info', transports: [cap] }).withBindings({ scope: 'base' })
    log.info('a', { scope: 'call' })
    expect((cap.entries[0]!.context as Record<string, unknown>).scope).toBe('call')
  })
})
