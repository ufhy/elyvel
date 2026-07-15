import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import {
  BufferedFileTransport,
  DailyFileTransport,
  FileTransport,
  type LogEntry,
  LogManager,
  Logger,
  type Transport,
} from '../src/logger'

const entry = (message: string, time = '2026-07-11T00:00:00.000Z'): LogEntry => ({
  time,
  level: 'info',
  message,
})

class CaptureTransport implements Transport {
  entries: LogEntry[] = []
  log(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

describe('transports', () => {
  test('FileTransport appends one JSON line per entry', () => {
    const path = join(tmpdir(), `ravel-log-${process.pid}-${Date.now()}.log`)
    const logger = new Logger({ level: 'info', transports: [new FileTransport(path)] })
    logger.info('first', { x: 1 })
    logger.warn('second')

    const lines = readFileSync(path, 'utf8').trim().split('\n')
    rmSync(path)

    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0] as string)).toMatchObject({ message: 'first', level: 'info', x: 1 })
    expect(JSON.parse(lines[1] as string)).toMatchObject({ message: 'second', level: 'warn' })
  })

  test('a logger fans out to all transports', () => {
    const a = new CaptureTransport()
    const b = new CaptureTransport()
    const logger = new Logger({ level: 'info', transports: [a, b] })
    logger.info('hi')
    expect(a.entries).toHaveLength(1)
    expect(b.entries).toHaveLength(1)
  })

  test('child shares parent transports and prefixes the scope', () => {
    const cap = new CaptureTransport()
    const logger = new Logger({ level: 'info', name: 'app', transports: [cap] }).child('db')
    logger.info('query')
    expect(cap.entries[0]?.name).toBe('app:db')
  })

  test('FileTransport rotates when the file exceeds maxBytes', () => {
    const path = join(tmpdir(), `ravel-rot-${process.pid}-${Date.now()}.log`)
    const logger = new Logger({
      level: 'info',
      transports: [new FileTransport(path, { maxBytes: 200, maxFiles: 3 })],
    })

    for (let i = 0; i < 20; i++) logger.info(`entry number ${i} with some padding text`)

    expect(existsSync(`${path}.1`)).toBe(true) // at least one rotation happened
    const active = readFileSync(path, 'utf8').trim().split('\n')
    rmSync(path)
    rmSync(`${path}.1`, { force: true })
    rmSync(`${path}.2`, { force: true })
    rmSync(`${path}.3`, { force: true })

    expect(active.length).toBeGreaterThan(0) // active file still receives writes
  })

  test('BufferedFileTransport batches lines until flushed', () => {
    const path = join(tmpdir(), `ravel-buf-${process.pid}-${Date.now()}.log`)
    const t = new BufferedFileTransport(path, { flushEvery: 100 })
    t.log(entry('a'))
    t.log(entry('b'))
    expect(existsSync(path)).toBe(false) // still buffered

    t.flush()
    const lines = readFileSync(path, 'utf8').trim().split('\n')
    rmSync(path)
    expect(lines).toHaveLength(2)
  })

  test('FileTransport gzips rotated files when compress is on', () => {
    const path = join(tmpdir(), `ravel-gz-${process.pid}-${Date.now()}.log`)
    const logger = new Logger({
      level: 'info',
      transports: [new FileTransport(path, { maxBytes: 200, maxFiles: 3, compress: true })],
    })
    for (let i = 0; i < 20; i++) logger.info(`entry number ${i} with padding to force rotation`)

    expect(existsSync(`${path}.1.gz`)).toBe(true)
    const restored = gunzipSync(readFileSync(`${path}.1.gz`)).toString('utf8')
    rmSync(path, { force: true })
    rmSync(`${path}.1.gz`, { force: true })
    rmSync(`${path}.2.gz`, { force: true })
    rmSync(`${path}.3.gz`, { force: true })

    expect(restored).toContain('entry number')
  })

  test('DailyFileTransport writes to a per-day file', () => {
    const dir = join(tmpdir(), `ravel-daily-${process.pid}-${Date.now()}`)
    const t = new DailyFileTransport(join(dir, 'app'))
    t.log(entry('morning', '2026-07-11T08:00:00.000Z'))

    const file = join(dir, 'app-2026-07-11.log')
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain('morning')
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('LogManager', () => {
  test('routes channel() to the right logger and throws on unknown', () => {
    const a = new Logger({ level: 'info' })
    const b = new Logger({ level: 'info' })
    const manager = new LogManager(
      new Map([
        ['a', a],
        ['b', b],
      ]),
      a,
    )

    expect(manager.default).toBe(a)
    expect(manager.channel('b')).toBe(b)
    expect(() => manager.channel('nope')).toThrow(/not defined/)
  })
})
