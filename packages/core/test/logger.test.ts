import type { Transport } from '../src/logger'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { createLogger, FileTransport, Logger } from '../src/logger'

/** Capture console output for the duration of `fn`. */
function capture(fn: () => void): { out: string[], err: string[] } {
  const out: string[] = []
  const err: string[] = []
  const origLog = console.log
  const origErr = console.error
  console.log = (line: string) => out.push(line)
  console.error = (line: string) => err.push(line)
  try {
    fn()
  }
  finally {
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

  test('a failing transport (disk full, permission denied, …) never throws out of .log() — falls back to stderr', () => {
    const goodEntries: unknown[] = []
    const failing: Transport = {
      log: () => {
        throw new Error('ENOSPC: no space left on device')
      },
    }
    const good: Transport = { log: entry => goodEntries.push(entry) }
    const log = new Logger({ level: 'info', transports: [failing, good] })

    const { err } = capture(() => {
      expect(() => log.error('disk is full, but the request must survive')).not.toThrow()
    })
    // The other (working) transport still received the entry.
    expect(goodEntries).toHaveLength(1)
    // The failure itself, plus the lost entry, land on stderr instead of vanishing.
    expect(err.some(line => line.includes('log transport failed'))).toBe(true)
    expect(err.some(line => line.includes('disk is full, but the request must survive'))).toBe(true)
  })
})

describe('FileTransport pretty mode', () => {
  test('pretty: false (default) writes one dense JSON object per line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elyvel-log-'))
    const path = join(dir, 'app.log')
    const log = new Logger({ level: 'info', transports: [new FileTransport(path)] })
    log.error('boom', { stack: 'Error: boom\n    at fn (file.ts:1:1)' })

    const content = readFileSync(path, 'utf8').trim()
    expect(content.split('\n')).toHaveLength(1) // the whole entry, stack included, is one line
    expect(JSON.parse(content).stack).toContain('\n') // the newline survives, just escaped
    rmSync(dir, { recursive: true, force: true })
  })

  test('pretty: true writes a human-readable, genuinely multi-line entry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elyvel-log-'))
    const path = join(dir, 'app.log')
    const log = new Logger({ level: 'info', transports: [new FileTransport(path, { pretty: true })] })
    log.error('POST /blog threw', {
      requestId: 'abc-123',
      stack: 'Error: boom\n    at fn (file.ts:1:1)\n    at handle (elysia.mjs:2:2)',
    })

    const lines = readFileSync(path, 'utf8').trimEnd().split('\n')
    expect(lines[0]).toContain('ERROR')
    expect(lines[0]).toContain('POST /blog threw')
    expect(lines.some(l => l.includes('requestId=abc-123'))).toBe(true)
    expect(lines).toContain('  stack:')
    // The stack trace is real, separately-readable lines — not one escaped blob.
    expect(lines.some(l => l.trim() === 'Error: boom')).toBe(true)
    expect(lines.some(l => l.trim() === 'at fn (file.ts:1:1)')).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})
