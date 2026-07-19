import { afterEach, describe, expect, test } from 'bun:test'
import { configureExceptionHandling, resetExceptionHandling, shouldReportError } from '../src/exception-handling'

afterEach(() => resetExceptionHandling())

class ExpectedBusinessError extends Error {}

describe('shouldReportError', () => {
  test('with no config, everything is reported (unchanged default behavior)', () => {
    expect(shouldReportError(new Error('anything'))).toBe(true)
    expect(shouldReportError(new ExpectedBusinessError('expected'))).toBe(true)
  })

  test('dontReport skips instances of the listed classes', () => {
    configureExceptionHandling({ dontReport: [ExpectedBusinessError] })
    expect(shouldReportError(new ExpectedBusinessError('nope'))).toBe(false)
    expect(shouldReportError(new Error('still reported'))).toBe(true)
  })

  test('dontReportWhen skips based on a predicate', () => {
    configureExceptionHandling({
      dontReportWhen: error => error instanceof Error && error.message.includes('noisy'),
    })
    expect(shouldReportError(new Error('a noisy one'))).toBe(false)
    expect(shouldReportError(new Error('a real one'))).toBe(true)
  })

  test('dontReportDuplicates skips the exact same instance the second time', () => {
    configureExceptionHandling({ dontReportDuplicates: true })
    const error = new Error('flaky')
    expect(shouldReportError(error)).toBe(true)
    expect(shouldReportError(error)).toBe(false)
    // A different instance with the same message is still its own report.
    expect(shouldReportError(new Error('flaky'))).toBe(true)
  })

  test('throttle caps how many of the same "kind" get reported per minute', () => {
    configureExceptionHandling({ throttle: () => 2 })
    expect(shouldReportError(new Error('storm'))).toBe(true)
    expect(shouldReportError(new Error('storm'))).toBe(true)
    expect(shouldReportError(new Error('storm'))).toBe(false) // 3rd within the window
    // A different message is a different bucket — unaffected by the storm above.
    expect(shouldReportError(new Error('unrelated'))).toBe(true)
  })

  test('throttle returning undefined for a given error means no limit', () => {
    configureExceptionHandling({ throttle: error => (error instanceof RangeError ? 1 : undefined) })
    expect(shouldReportError(new Error('always reported'))).toBe(true)
    expect(shouldReportError(new Error('always reported'))).toBe(true)
    expect(shouldReportError(new Error('always reported'))).toBe(true)
  })
})
