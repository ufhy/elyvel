import { describe, expect, test } from 'bun:test'
import { dateParts, formatDate, getAppTimezone, setAppTimezone } from '../src/datetime'

const instant = new Date('2026-01-01T00:00:00.000Z') // midnight UTC

describe('timezone helpers', () => {
  test('formatDate renders the app timezone', () => {
    setAppTimezone('Asia/Makassar') // UTC+8
    const parts = dateParts(instant)
    expect(parts.hour).toBe('08') // 00:00 UTC → 08:00 in Makassar
    expect(parts.day).toBe('01')

    setAppTimezone('UTC')
    expect(dateParts(instant).hour).toBe('00')
  })

  test('formatDate accepts a per-call timezone override', () => {
    setAppTimezone('UTC')
    const s = formatDate(instant, { timeZone: 'America/New_York', hour: '2-digit', hour12: false }, 'en-US')
    expect(s).toContain('19') // 00:00 UTC → 19:00 previous day in New York (UTC-5)
  })

  test('getAppTimezone reflects the set value', () => {
    setAppTimezone('Europe/Paris')
    expect(getAppTimezone()).toBe('Europe/Paris')
    setAppTimezone('UTC')
  })
})
