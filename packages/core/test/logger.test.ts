import { describe, expect, test } from 'bun:test'
import { createLogger } from '../src/logger'

/** Capture console output for the duration of `fn`. */
function capture(fn: () => void): { out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  const origLog = console.log
  const origErr = console.error
  console.log = (line: string) => out.push(line)
  console.error = (line: string) => err.push(line)
  try {
    fn()
  } finally {
    console.log = origLog
    console.error = origErr
  }
  return { out, err }
}

describe('Logger', () => {
  test('drops messages below the configured level', () => {
    const log = createLogger({ level: 'warn', pretty: false })
    const { out, err } = capture(() => {
      log.debug('nope')
      log.info('nope')
      log.warn('yes')
      log.error('yes')
    })
    expect(out).toHaveLength(0)
    expect(err).toHaveLength(2)
  })

  test('emits structured JSON when not pretty', () => {
    const log = createLogger({ level: 'info', pretty: false })
    const { out } = capture(() => log.info('hello', { user: 1 }))
    const parsed = JSON.parse(out[0] as string)
    expect(parsed.level).toBe('info')
    expect(parsed.message).toBe('hello')
    expect(parsed.user).toBe(1)
  })

  test('child appends a scope name', () => {
    const log = createLogger({ level: 'info', pretty: false }).child('auth')
    const { out } = capture(() => log.info('login'))
    expect(JSON.parse(out[0] as string).name).toBe('auth')
  })

  test('silent suppresses everything', () => {
    const log = createLogger({ level: 'silent', pretty: false })
    const { out, err } = capture(() => {
      log.error('should not appear')
    })
    expect(out).toHaveLength(0)
    expect(err).toHaveLength(0)
  })
})
