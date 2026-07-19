import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { deleteLogFile, listLogFiles, readEntries, resolveLogFile } from '../src/reader'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'elyvel-logviewer-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function line(entry: Record<string, unknown>): string {
  return `${JSON.stringify(entry)}\n`
}

describe('listLogFiles', () => {
  test('empty/missing directory yields an empty list', () => {
    expect(listLogFiles(join(dir, 'does-not-exist'))).toEqual([])
  })

  test('lists the active file, size-rotated, and daily-rotated files — ignores non-logs', () => {
    writeFileSync(join(dir, 'app.log'), '')
    writeFileSync(join(dir, 'app.log.1'), '')
    writeFileSync(join(dir, 'app-2026-07-19.log'), '')
    writeFileSync(join(dir, 'notes.txt'), '')
    const names = listLogFiles(dir).map(f => f.name).sort()
    expect(names).toEqual(['app-2026-07-19.log', 'app.log', 'app.log.1'])
  })
})

describe('resolveLogFile', () => {
  test('resolves a plain filename inside the directory', () => {
    expect(resolveLogFile(dir, 'app.log')).toBe(join(dir, 'app.log'))
  })

  test('rejects path traversal attempts', () => {
    expect(resolveLogFile(dir, '../../etc/passwd')).toBeUndefined()
    expect(resolveLogFile(dir, '../secret.log')).toBeUndefined()
  })
})

describe('readEntries', () => {
  test('parses JSON lines, skipping blank/malformed ones', () => {
    const path = join(dir, 'app.log')
    writeFileSync(path, `${line({ level: 'info', message: 'a' })}\nnot json\n${line({ level: 'error', message: 'b' })}`)
    const { entries, total } = readEntries(path)
    expect(total).toBe(2)
    expect(entries.map(e => e.message)).toEqual(['b', 'a']) // desc (newest/last-in-file first) by default
  })

  test('filters by level', () => {
    const path = join(dir, 'app.log')
    writeFileSync(path, line({ level: 'info', message: 'a' }) + line({ level: 'error', message: 'b' }))
    const { entries } = readEntries(path, { level: 'error' })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.message).toBe('b')
  })

  test('full-text search matches anywhere in the raw line', () => {
    const path = join(dir, 'app.log')
    writeFileSync(path, line({ level: 'info', message: 'hello world' }) + line({ level: 'info', message: 'goodbye' }))
    const { entries } = readEntries(path, { q: 'WORLD' }) // case-insensitive
    expect(entries).toHaveLength(1)
    expect(entries[0]?.message).toBe('hello world')
  })

  test('paginates', () => {
    const path = join(dir, 'app.log')
    const lines = Array.from({ length: 5 }, (_, i) => line({ level: 'info', message: `m${i}` })).join('')
    writeFileSync(path, lines)
    const page1 = readEntries(path, { perPage: 2, page: 1 })
    expect(page1.total).toBe(5)
    expect(page1.entries).toHaveLength(2)
    const page3 = readEntries(path, { perPage: 2, page: 3 })
    expect(page3.entries).toHaveLength(1) // remainder
  })

  test('direction: asc keeps the original (oldest-first) file order', () => {
    const path = join(dir, 'app.log')
    writeFileSync(path, line({ message: 'first' }) + line({ message: 'second' }))
    const { entries } = readEntries(path, { direction: 'asc' })
    expect(entries.map(e => e.message)).toEqual(['first', 'second'])
  })

  test('a missing file yields an empty page, not a throw', () => {
    const { entries, total } = readEntries(join(dir, 'nope.log'))
    expect(entries).toEqual([])
    expect(total).toBe(0)
  })
})

describe('readEntries — pretty mode (FileTransport pretty: true)', () => {
  test('parses header lines and absorbs continuation (context + stack) into _raw', () => {
    const path = join(dir, 'app.log')
    writeFileSync(path, [
      '2026-07-19T02:42:22.474Z INFO (app) application booted',
      '2026-07-19T02:42:25.892Z ERROR (http) request failed',
      '  requestId=abc123 status=500 ms=3.14',
      '  stack:',
      '    Error: boom',
      '        at handler (app.ts:10:5)',
      '',
    ].join('\n'))
    const { entries, total } = readEntries(path)
    expect(total).toBe(2)
    // desc: newest (last-in-file) first
    expect(entries[0]?.level).toBe('error')
    expect(entries[0]?.name).toBe('http')
    expect(entries[0]?.message).toBe('request failed')
    expect(entries[0]?._raw).toBe('  requestId=abc123 status=500 ms=3.14\n  stack:\n    Error: boom\n        at handler (app.ts:10:5)')
    expect(entries[1]?.message).toBe('application booted')
    expect(entries[1]?._raw).toBeUndefined()
  })

  test('filters by level and full-text search still work against pretty-mode entries', () => {
    const path = join(dir, 'app.log')
    writeFileSync(path, [
      '2026-07-19T02:42:22.474Z INFO (app) hello world',
      '2026-07-19T02:42:23.000Z ERROR (app) goodbye',
      '  requestId=xyz',
    ].join('\n'))
    const byLevel = readEntries(path, { level: 'error' })
    expect(byLevel.entries).toHaveLength(1)
    expect(byLevel.entries[0]?.message).toBe('goodbye')

    const byQuery = readEntries(path, { q: 'xyz' })
    expect(byQuery.entries).toHaveLength(1)
    expect(byQuery.entries[0]?.message).toBe('goodbye')
  })

  test('a message with no (name) scope still parses', () => {
    const path = join(dir, 'app.log')
    writeFileSync(path, '2026-07-19T02:42:22.474Z INFO Fullstack Vue listening')
    const { entries } = readEntries(path)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.name).toBeUndefined()
    expect(entries[0]?.message).toBe('Fullstack Vue listening')
  })
})

describe('deleteLogFile', () => {
  test('removes the file; a missing file is a no-op', () => {
    const path = join(dir, 'app.log')
    writeFileSync(path, 'x')
    deleteLogFile(path)
    expect(listLogFiles(dir)).toEqual([])
    expect(() => deleteLogFile(path)).not.toThrow()
  })
})
