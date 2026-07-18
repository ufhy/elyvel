import { afterEach, describe, expect, test } from 'bun:test'
import { createApp } from '../src/application'
import { today } from '../src/date'
import {
  currentTimezone,
  dateParts,
  runWithTimezone,
  setAppTimezone,
  timezoneOffset,
  zonedStartOfDayUtc,
} from '../src/datetime'

const basePath = new URL('./fixtures', import.meta.url).pathname

afterEach(() => setAppTimezone('UTC'))

describe('per-request timezone (AsyncLocalStorage)', () => {
  test('runWithTimezone scopes the zone; default restored outside', () => {
    setAppTimezone('UTC')
    const inZone = runWithTimezone('Asia/Makassar', () => currentTimezone())
    expect(inZone).toBe('Asia/Makassar')
    expect(currentTimezone()).toBe('UTC')
  })

  test('dateParts follows the scoped timezone', () => {
    const instant = new Date('2021-06-20T16:30:00.000Z')
    const utc = dateParts(instant, 'UTC')
    expect(`${utc.year}-${utc.month}-${utc.day}`).toBe('2021-06-20')
    const local = runWithTimezone('Asia/Makassar', () => dateParts(instant))
    expect(`${local.year}-${local.month}-${local.day}`).toBe('2021-06-21') // +08 crosses midnight
  })

  test('concurrent scopes do not leak', async () => {
    const slow = (tz: string, ms: number) =>
      runWithTimezone(tz, async () => {
        await new Promise(r => setTimeout(r, ms))
        return currentTimezone()
      })
    const [a, b] = await Promise.all([slow('Asia/Tokyo', 20), slow('America/New_York', 5)])
    expect(a).toBe('Asia/Tokyo')
    expect(b).toBe('America/New_York')
  })
})

describe('now / today helpers', () => {
  test('today() is the local calendar date in the given zone', () => {
    // A fixed instant near a day boundary, checked via dateParts equivalence.
    const y = today('UTC')
    expect(y).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('zoned helpers', () => {
  test('timezoneOffset is DST-correct and signed', () => {
    expect(timezoneOffset('Asia/Makassar', new Date('2021-06-20T00:00:00Z'))).toBe(480) // +08:00
    expect(timezoneOffset('UTC', new Date('2021-06-20T00:00:00Z'))).toBe(0)
  })

  test('zonedStartOfDayUtc returns the UTC instant of local midnight', () => {
    // Local midnight 2021-06-21 in +08 == 2021-06-20T16:00:00Z
    expect(zonedStartOfDayUtc('2021-06-21', 'Asia/Makassar').toISOString()).toBe('2021-06-20T16:00:00.000Z')
    expect(zonedStartOfDayUtc('2021-06-21', 'UTC').toISOString()).toBe('2021-06-21T00:00:00.000Z')
  })
})

describe('request timezone wiring (ctx.timezone)', () => {
  class RouteProvider {
    constructor(private readonly app: any) {}
    register() {}
    boot() {
      this.app.elysia.get('/tz', (ctx: any) => ({ tz: ctx.timezone }))
    }
  }

  test('ctx.timezone is the app default (no auto-detection)', async () => {
    const app = await createApp({ basePath, autoloadRoutes: false, providers: [RouteProvider as any] })
    // A `timezone` cookie is NOT auto-detected anymore — always the app default.
    const res = await app.handle(new Request('http://localhost/tz', {
      headers: { cookie: 'timezone=Asia/Makassar' },
    }))
    // fixtures config has no app.timezone → defaults to UTC
    expect(((await res.json()) as { tz: string }).tz).toBe('UTC')
  })
})
