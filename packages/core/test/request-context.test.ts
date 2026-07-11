import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { type LogEntry, Logger, type Transport } from '../src/logger'
import { requestContext } from '../src/request-context'

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

const http = (cap: CaptureTransport) => cap.entries.filter((e) => e.name === 'http')

/** onAfterResponse fires after the response is returned, so let it settle. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('requestContext', () => {
  test('logs a successful request with status and duration', async () => {
    const { cap, app } = build()
    await app.handle(new Request('http://localhost/ok'))
    await tick()

    const entry = http(cap).find((e) => e.message.includes('/ok'))
    expect(entry).toBeDefined()
    expect(entry?.level).toBe('info')
    expect(entry?.context?.status).toBe(200)
    expect(typeof entry?.context?.ms).toBe('number')
    expect(typeof entry?.context?.requestId).toBe('string')
  })

  test('the per-request logger correlates handler logs with the request', async () => {
    const { cap, app } = build()
    await app.handle(new Request('http://localhost/ok'))
    await tick()

    const handlerLog = cap.entries.find((e) => e.message === 'handling ok')
    const httpLog = http(cap).find((e) => e.message.includes('/ok'))
    expect(handlerLog).toBeDefined()
    expect(handlerLog?.context?.requestId).toBe(httpLog?.context?.requestId)
  })

  test('logs thrown errors at error level with code and stack', async () => {
    const { cap, app } = build()
    await app.handle(new Request('http://localhost/boom'))

    const errors = http(cap).filter((e) => e.level === 'error')
    expect(errors.length).toBeGreaterThanOrEqual(1)
    const err = errors.find((e) => JSON.stringify(e.context).includes('kaboom'))
    expect(err).toBeDefined()
    expect(typeof err?.context?.stack).toBe('string')
    expect(typeof err?.context?.requestId).toBe('string')
  })
})
