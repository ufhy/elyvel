import { describe, expect, test } from 'bun:test'
import { parseCron } from '../src/cron'

const dow = (expr: string): number[] => [...parseCron(expr).dayOfWeek].sort((a, b) => a - b)

/**
 * Regression: Sunday-as-7 was normalized by rewriting the raw field text
 * (`\b7\b` → `0`), which corrupted any 7 that wasn't a standalone value —
 * `1-7` became the backwards range `1-0`, and a step of 7 became a step of
 * 0, so both threw `Invalid cron field` even though they are valid cron.
 */
describe('day-of-week accepts 7 as Sunday in every form', () => {
  test('a range ending at 7 spans the whole week instead of throwing', () => {
    expect(dow('0 0 * * 1-7')).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  test('a step of 7 is Sunday only instead of throwing', () => {
    expect(dow('0 0 * * */7')).toEqual([0])
  })

  test('bare 7 and comma lists still fold onto Sunday', () => {
    expect(dow('0 0 * * 7')).toEqual([0])
    expect(dow('0 0 * * 1,7')).toEqual([0, 1])
  })

  test('ordinary ranges are unchanged, and out-of-range values still throw', () => {
    expect(dow('0 0 * * 1-5')).toEqual([1, 2, 3, 4, 5])
    expect(dow('0 0 * * 0')).toEqual([0])
    expect(() => parseCron('0 0 * * 17')).toThrow()
    expect(() => parseCron('0 0 * * 8')).toThrow()
  })
})
