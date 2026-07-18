import { afterEach, describe, expect, test } from 'bun:test'
import { date, isDate, now, today } from '../src/date'
import { runWithTimezone, setAppTimezone } from '../src/datetime'
import 'dayjs/locale/id' // apps load the dayjs locales they need

afterEach(() => setAppTimezone('UTC'))

describe('date() — the framework date object (dayjs)', () => {
  const instant = '2026-07-08T09:05:00.000Z'

  test('parses and formats with a token pattern', () => {
    setAppTimezone('UTC')
    expect(date(instant).format('DD/MM/YYYY HH:mm')).toBe('08/07/2026 09:05')
    expect(date(instant).format('MM/DD/YY')).toBe('07/08/26')
  })

  test('renders in the active timezone by default', () => {
    const inZone = runWithTimezone('Asia/Makassar', () => date(instant).format('DD/MM/YYYY HH:mm'))
    expect(inZone).toBe('08/07/2026 17:05') // +08
  })

  test('.tz() overrides the display zone (same instant)', () => {
    expect(date(instant).tz('America/New_York').format('HH:mm')).toBe('05:05') // EDT −04
    expect(date(instant).toISOString()).toBe(instant) // instant unchanged
  })

  test('manipulation is immutable and chainable', () => {
    const base = date(instant)
    expect(base.add(3, 'day').toISOString()).toBe('2026-07-11T09:05:00.000Z')
    expect(base.toISOString()).toBe(instant) // original untouched
    expect(date(instant).startOf('day').tz('UTC').format('HH:mm')).toBe('00:00')
  })

  test('comparison + diff', () => {
    expect(date('2026-01-01').isBefore(date('2026-02-01'))).toBe(true)
    expect(date('2026-01-10').diff(date('2026-01-01'), 'day')).toBe(9)
  })

  test('relative time honors locale', () => {
    const rel = date(instant).locale('id').from(date('2026-07-15T09:05:00.000Z'))
    expect(rel).toContain('hari') // "7 hari yang lalu"
  })

  test('now() / today() use the active timezone', () => {
    expect(today('UTC')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(isDate(now())).toBe(true)
    expect(isDate(new Date())).toBe(false)
  })
})
