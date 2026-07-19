import type { LogEntry, Transport } from '../src/logger'
import { afterEach, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { configureExceptionHandling, resetExceptionHandling } from '../src/exception-handling'
import { Logger } from '../src/logger'
import { requestContext } from '../src/request-context'

afterEach(() => resetExceptionHandling())

class CaptureTransport implements Transport {
  entries: LogEntry[] = []
  log(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

function build() {
  const cap = new CaptureTransport()
  const logger = new Logger({ level: 'debug', transports: [cap] })
  const app = new Elysia()
    .use(requestContext(logger))
    .get('/ok', ({ requestId, log }) => {
      log.info('handling ok') // per-request logger is typed + correlated
      return { requestId }
    })
    .get('/boom', () => {
      throw new Error('kaboom')
    })
  return { cap, app }
}

/** Simulates betterAuthPlugin's global `user` derive, mounted before requestContext. */
function buildWithUser(user: { id: string } | null) {
  const cap = new CaptureTransport()
  const logger = new Logger({ level: 'debug', transports: [cap] })
  const app = new Elysia()
    .derive({ as: 'global' }, () => ({ user }))
    .use(requestContext(logger))
    .get('/ok', () => ({ ok: true }))
    .get('/boom', () => {
      throw new Error('kaboom')
    })
  return { cap, app }
}

const http = (cap: CaptureTransport) => cap.entries.filter(e => e.name === 'http')

/** onAfterResponse fires after the response is returned, so let it settle. */
const tick = () => new Promise(resolve => setTimeout(resolve, 20))

describe('requestContext', () => {
  test('logs a successful request at debug level (framework noise, not app-level info)', async () => {
    const { cap, app } = build()
    await app.handle(new Request('http://localhost/ok'))
    await tick()

    const entry = http(cap).find(e => e.message.includes('GET /ok'))
    expect(entry).toBeDefined()
    expect(entry?.level).toBe('debug')
    expect(entry?.context?.status).toBe(200)
    expect(typeof entry?.context?.ms).toBe('number')
    expect(typeof entry?.context?.requestId).toBe('string')
  })

  test('the per-request logger correlates handler logs with the request', async () => {
    const { cap, app } = build()
    await app.handle(new Request('http://localhost/ok'))
    await tick()

    const handlerLog = cap.entries.find(e => e.message === 'handling ok')
    const httpLog = http(cap).find(e => e.message.includes('/ok'))
    expect(handlerLog).toBeDefined()
    expect(handlerLog?.context?.requestId).toBe(httpLog?.context?.requestId)
  })

  test('logs thrown errors at error level with code and stack', async () => {
    const { cap, app } = build()
    await app.handle(new Request('http://localhost/boom'))

    const errors = http(cap).filter(e => e.level === 'error')
    expect(errors.length).toBeGreaterThanOrEqual(1)
    const err = errors.find(e => JSON.stringify(e.context).includes('kaboom'))
    expect(err).toBeDefined()
    expect(typeof err?.context?.stack).toBe('string')
    expect(typeof err?.context?.requestId).toBe('string')
  })

  test('attaches the signed-in user\'s id to both the request summary and the error log', async () => {
    const { cap, app } = buildWithUser({ id: 'user-42' })
    await app.handle(new Request('http://localhost/ok'))
    await app.handle(new Request('http://localhost/boom'))
    await tick()

    const okLog = http(cap).find(e => e.message.includes('/ok'))
    expect(okLog?.context?.userId).toBe('user-42')

    const errorLog = http(cap).find(e => e.level === 'error' && JSON.stringify(e.context).includes('kaboom'))
    expect(errorLog?.context?.userId).toBe('user-42')
  })

  test('omits userId entirely for a guest (no user derived)', async () => {
    const { cap, app } = buildWithUser(null)
    await app.handle(new Request('http://localhost/ok'))
    await tick()

    const okLog = http(cap).find(e => e.message.includes('/ok'))
    expect(okLog?.context).not.toHaveProperty('userId')
  })

  test('dontReport suppresses the error log entry, but the response is still a normal 500', async () => {
    configureExceptionHandling({ dontReportWhen: () => true })
    const { cap, app } = build()
    const res = await app.handle(new Request('http://localhost/boom'))
    await tick()

    expect(res.status).toBe(500) // client-facing behavior is unaffected
    const errors = http(cap).filter(e => e.level === 'error' && JSON.stringify(e.context).includes('kaboom'))
    expect(errors).toHaveLength(0) // but it never made it into the log
  })
})
