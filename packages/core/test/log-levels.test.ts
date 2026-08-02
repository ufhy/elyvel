import type { LeveledLevel, LogEntry, Transport } from '../src/logger'
import { describe, expect, test } from 'bun:test'
import { ConsoleTransport, Logger } from '../src/logger'

function capture(level?: LeveledLevel | 'silent') {
  const entries: LogEntry[] = []
  const transport: Transport = { log: entry => void entries.push(entry) }
  return { entries, log: new Logger({ level: level ?? 'debug', transports: [transport] }) }
}

/**
 * PSR-3 / RFC 5424, which is what Laravel exposes: `Log::emergency()` down to
 * `Log::debug()`. Only four of the eight existed here, so anyone arriving from
 * Laravel and writing `log.critical(...)` hit a type error, and severities above
 * `error` had nowhere to go — a database that will not accept connections logged
 * at the same level as a failed request.
 */
describe('RFC 5424 levels', () => {
  const ALL: LeveledLevel[] = [
    'debug',
    'info',
    'notice',
    'warning',
    'error',
    'critical',
    'alert',
    'emergency',
  ]

  test('every PSR-3 level is a method that records its own name', () => {
    const { entries, log } = capture()
    for (const level of ALL) log[level]('m')
    expect(entries.map(e => e.level)).toEqual(ALL)
  })

  /**
   * `warn` predates `warning` here. Keeping it avoids breaking every app that
   * uses it, but it must not create a second spelling in log files: filters and
   * the log viewer would then match one and miss the other.
   */
  test('warn() is accepted and stored as warning', () => {
    const { entries, log } = capture()
    log.warn('m')
    expect(entries[0]?.level).toBe('warning')
  })

  test('severity ordering follows RFC 5424, so a threshold means what it says', () => {
    const { entries, log } = capture('warning')
    for (const level of ALL) log[level]('m')
    expect(entries.map(e => e.level)).toEqual(['warning', 'error', 'critical', 'alert', 'emergency'])
  })

  test('a `warn` threshold behaves exactly like `warning`', () => {
    const { entries, log } = capture('warn')
    log.notice('no')
    log.warning('yes')
    log.emergency('yes')
    expect(entries).toHaveLength(2)
  })

  test('silent suppresses even emergency', () => {
    const { entries, log } = capture('silent')
    log.emergency('m')
    expect(entries).toHaveLength(0)
  })

  test('log() takes a level chosen at runtime', () => {
    const { entries, log } = capture()
    log.log('critical', 'm')
    expect(entries[0]?.level).toBe('critical')
  })
})

/**
 * Regression: the console transport picked stderr by comparing level *names*
 * (`=== 'error' || === 'warn'`). The moment levels above `error` existed, the
 * most severe entries the framework can emit were the ones going to stdout —
 * invisible to anything that watches stderr for trouble.
 */
describe('console stream selection', () => {
  function streamFor(level: LeveledLevel): 'out' | 'err' {
    const out: string[] = []
    const err: string[] = []
    const originalLog = console.log
    const originalError = console.error
    console.log = (line: string) => void out.push(line)
    console.error = (line: string) => void err.push(line)
    try {
      new Logger({ level: 'debug', transports: [new ConsoleTransport(false)] })[level]('m')
    }
    finally {
      console.log = originalLog
      console.error = originalError
    }
    return err.length > 0 ? 'err' : 'out'
  }

  test('warning and above go to stderr', () => {
    for (const level of ['warning', 'error', 'critical', 'alert', 'emergency'] as LeveledLevel[])
      expect(streamFor(level)).toBe('err')
  })

  test('notice and below go to stdout', () => {
    for (const level of ['debug', 'info', 'notice'] as LeveledLevel[])
      expect(streamFor(level)).toBe('out')
  })
})
