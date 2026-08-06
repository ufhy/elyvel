import type { BoostContext } from '../src/mcp/tools'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '@elyvel/core'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { assertReadOnlyQuery, boostTools, logDirectory } from '../src/mcp/tools'

const fixtures = new URL('./fixtures', import.meta.url).pathname

function tool(name: string) {
  const found = boostTools.find(t => t.name === name)
  if (!found)
    throw new Error(`no such tool: ${name}`)
  return found
}

/** A ctx for tools that only read config — no app boot needed. */
function fakeCtx(config: Record<string, unknown>, cwd = fixtures): BoostContext {
  return {
    cwd,
    app: {
      config: {
        get: (key: string, fallback?: unknown) => (key in config ? config[key] : fallback),
      },
    } as never,
  }
}

describe('assertReadOnlyQuery', () => {
  test('allows read statements, with or without a trailing semicolon', () => {
    expect(assertReadOnlyQuery('SELECT * FROM users')).toBeNull()
    expect(assertReadOnlyQuery('  select 1;  ')).toBeNull()
    expect(assertReadOnlyQuery('WITH x AS (SELECT 1) SELECT * FROM x')).toBeNull()
    expect(assertReadOnlyQuery('EXPLAIN SELECT 1')).toBeNull()
    expect(assertReadOnlyQuery('PRAGMA table_info(users)')).toBeNull()
  })

  test('rejects writes, multiple statements, and empty input', () => {
    expect(assertReadOnlyQuery('DELETE FROM users')).toContain('read-only')
    expect(assertReadOnlyQuery('UPDATE users SET name = 1')).toContain('read-only')
    expect(assertReadOnlyQuery('INSERT INTO users VALUES (1)')).toContain('read-only')
    expect(assertReadOnlyQuery('DROP TABLE users')).toContain('read-only')
    expect(assertReadOnlyQuery('SELECT 1; DELETE FROM users')).toContain('Multiple statements')
    expect(assertReadOnlyQuery('   ')).toBe('Empty query.')
  })

  test('a write dressed as a read does not pass', () => {
    // The classic smuggle: read prefix, write after a semicolon.
    expect(assertReadOnlyQuery('SELECT 1;\nDROP TABLE users;')).toContain('Multiple statements')
  })
})

describe('config-only tools', () => {
  test('get-absolute-url falls back to localhost + configured port', async () => {
    const ctx = fakeCtx({ 'app.port': 4567 })
    expect(await tool('get-absolute-url').handle({}, ctx)).toBe('http://localhost:4567/')
    expect(await tool('get-absolute-url').handle({ path: '/login' }, ctx)).toBe('http://localhost:4567/login')
  })

  test('get-absolute-url honours app.url when configured', async () => {
    const ctx = fakeCtx({ 'app.url': 'https://example.test' })
    expect(await tool('get-absolute-url').handle({ path: '/dash' }, ctx)).toBe('https://example.test/dash')
  })

  test('database-connections lists connections and marks the default', async () => {
    const ctx = fakeCtx({
      'database.default': 'sqlite',
      'database.connections': {
        sqlite: { driver: 'sqlite' },
        pg: { driver: 'pg' },
      },
    })
    const out = await tool('database-connections').handle({}, ctx)
    expect(out).toContain('sqlite (sqlite) [default]')
    expect(out).toContain('pg (pg)')
  })
})

describe('log tools', () => {
  let dir: string
  let ctx: BoostContext

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'boost-logs-'))
    mkdirSync(join(dir, 'storage', 'logs'), { recursive: true })
    const lines = [
      { time: '2026-08-06T01:00:00.000Z', level: 'info', name: 'app', message: 'server started' },
      { time: '2026-08-06T02:00:00.000Z', level: 'error', name: 'app', message: 'boom', stack: 'Error: boom\n  at handler' },
      { time: '2026-08-06T03:00:00.000Z', level: 'info', name: 'app', message: 'request handled' },
    ]
    writeFileSync(join(dir, 'storage', 'logs', 'app.log'), `${lines.map(l => JSON.stringify(l)).join('\n')}\n`)
    ctx = fakeCtx({ 'logging.channels': { file: { path: 'storage/logs/app.log' } } }, dir)
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  test('logDirectory reads the file channel path from config', () => {
    expect(logDirectory(ctx)).toBe(join(dir, 'storage', 'logs'))
  })

  test('read-log-entries returns newest entries first and filters by level', async () => {
    const out = await tool('read-log-entries').handle({ entries: 2 }, ctx)
    expect(out).toContain('request handled')
    expect(out.indexOf('request handled')).toBeLessThan(out.indexOf('boom'))
    expect(out).not.toContain('server started')

    const errorsOnly = await tool('read-log-entries').handle({ level: 'error' }, ctx)
    expect(errorsOnly).toContain('boom')
    expect(errorsOnly).not.toContain('request handled')
  })

  test('last-error returns the error entry with its context', async () => {
    const out = await tool('last-error').handle({}, ctx)
    expect(out).toContain('"boom"')
    expect(out).toContain('at handler')
  })

  test('a directory with no logs says so instead of erroring', async () => {
    const empty = fakeCtx({}, mkdtempSync(join(tmpdir(), 'boost-empty-')))
    expect(await tool('read-log-entries').handle({}, empty)).toContain('No log files')
    expect(await tool('last-error').handle({}, empty)).toContain('No error entries')
  })
})

describe('booted-app tools', () => {
  let ctx: BoostContext
  let dbDir: string

  // The repo-wide test preload (bunfig.toml → database/test/setup.ts) closes
  // every DB connection after EACH test — so the app boots per test, against
  // a file-backed sqlite database that survives the reconnects.
  beforeAll(() => {
    dbDir = mkdtempSync(join(tmpdir(), 'boost-db-'))
    process.env.BOOST_TEST_DB = join(dbDir, 'test.sqlite')
  })

  afterAll(() => rmSync(dbDir, { recursive: true, force: true }))

  beforeEach(async () => {
    const app = await createApp({ basePath: fixtures })
    ctx = { app, cwd: fixtures }
  })

  test('application-info reports name, packages, database, and models', async () => {
    const out = await tool('application-info').handle({}, ctx)
    expect(out).toContain('Boost Fixture')
    expect(out).toContain(`Bun: ${Bun.version}`)
    expect(out).toContain('connection "sqlite" (sqlite)')
    expect(out).toContain('Widget')
  })

  test('list-routes shows the fixture route', async () => {
    const out = await tool('list-routes').handle({}, ctx)
    expect(out).toContain('/boost-fixture')
    expect(out).toContain('GET')
  })

  test('database-schema reads real tables and columns', async () => {
    const conn = ctx.app.make((await import('@elyvel/database')).DatabaseToken)
    await conn.statement('CREATE TABLE widgets (id INTEGER PRIMARY KEY, label TEXT NOT NULL)')

    const out = await tool('database-schema').handle({}, ctx)
    expect(out).toContain('widgets:')
    expect(out).toContain('label')

    const single = await tool('database-schema').handle({ table: 'widgets' }, ctx)
    expect(single).toContain('widgets:')
    expect(await tool('database-schema').handle({ table: 'nope' }, ctx)).toContain('No such table')
  })

  test('database-query runs a read and rejects a write', async () => {
    const conn = ctx.app.make((await import('@elyvel/database')).DatabaseToken)
    await conn.statement(`INSERT INTO widgets (label) VALUES ('a'), ('b')`)

    const rows = await tool('database-query').handle({ query: 'SELECT label FROM widgets ORDER BY label' }, ctx)
    expect(rows).toContain('"a"')
    expect(rows).toContain('"b"')

    const rejected = await tool('database-query').handle({ query: 'DELETE FROM widgets' }, ctx)
    expect(rejected).toContain('read-only')
    const still = await tool('database-query').handle({ query: 'SELECT count(*) AS n FROM widgets' }, ctx)
    expect(still).toContain('2')
  })

  test('tinker evaluates code with app, config, and models in scope — and variables persist', async () => {
    expect(await tool('tinker').handle({ code: 'config("app.name")' }, ctx)).toContain('Boost Fixture')
    expect(await tool('tinker').handle({ code: 'typeof Widget' }, ctx)).toContain('function')

    await tool('tinker').handle({ code: 'x = 6 * 7' }, ctx)
    expect(await tool('tinker').handle({ code: 'x' }, ctx)).toContain('42')
  })

  test('tinker returns errors as text and captures console output', async () => {
    const out = await tool('tinker').handle({ code: 'throw new Error("kaboom")' }, ctx)
    expect(out).toContain('kaboom')

    // A multi-statement line is statements, not an expression — its value is
    // undefined (same as `elyvel tinker`), but the printed output comes back.
    const printed = await tool('tinker').handle({ code: 'console.log("hello from tinker"); 1' }, ctx)
    expect(printed).toContain('hello from tinker')
    expect(printed).toContain('=> undefined')
  })
})
