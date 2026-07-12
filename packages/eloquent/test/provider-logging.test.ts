import { describe, expect, test } from 'bun:test'
import type { Application } from '@elysia-ravel/core'
import { useConnection } from '../src/connection'
import { EloquentServiceProvider } from '../src/database-provider'
import { SchemaBuilder } from '../src/schema'

interface LogCall {
  level: string
  message: string
  context?: Record<string, unknown>
}

/** Minimal stub of the pieces of Application the provider touches. */
function stubApp(config: Record<string, unknown>) {
  const calls: LogCall[] = []
  const requestHooks: (() => void)[] = []
  const record =
    (level: string) =>
    (message: string, context?: Record<string, unknown>) =>
      calls.push({ level, message, context })
  const sqlChannel = { error: record('error'), debug: record('debug'), warn: record('warn') }

  const app = {
    config: {
      get: (key: string, fallback?: unknown) => (key in config ? config[key] : fallback),
    },
    container: { instance: () => {} },
    logger: { child: () => sqlChannel },
    elysia: { onRequest: (fn: () => void) => requestHooks.push(fn) },
    path: (p: string) => p,
  }
  return { app: app as unknown as Application, calls, requestHooks }
}

const dbConfig = {
  'database.default': 'sqlite',
  'database.connections.sqlite': { driver: 'sqlite', database: ':memory:' },
}

describe('EloquentServiceProvider logging', () => {
  test('logs query errors to the sql channel with sql + bindings', async () => {
    const { app, calls } = stubApp(dbConfig)
    await new EloquentServiceProvider(app).register()

    await expect(useConnection().select('SELECT * FROM nope')).rejects.toThrow()

    const err = calls.find((c) => c.level === 'error')
    expect(err?.message).toBe('query failed')
    expect(err?.context?.sql).toContain('nope')
    expect(err?.context?.error).toBeDefined()
  })

  test('per-query debug logging is opt-in via database.log', async () => {
    const { app, calls } = stubApp({ ...dbConfig, 'database.log': true })
    await new EloquentServiceProvider(app).register()

    const conn = useConnection()
    await new SchemaBuilder(conn).create('t', (t) => t.id())
    await conn.select('SELECT 1 AS x')

    expect(calls.some((c) => c.level === 'debug')).toBe(true)
  })

  test('slow-query monitoring registers a per-request reset hook', async () => {
    const { app, requestHooks } = stubApp({ ...dbConfig, 'database.slowMs': 1 })
    await new EloquentServiceProvider(app).register()

    expect(requestHooks).toHaveLength(1) // reset wired onto the request lifecycle

    const conn = useConnection()
    await new SchemaBuilder(conn).create('t2', (t) => t.id())
    await conn.select('SELECT 1 AS x')

    requestHooks[0]?.() // simulate a new request boundary
    expect(conn.getTotalQueryDuration()).toBe(0) // counter reset per request
  })

  test('no request hook is registered when slowMs is unset', async () => {
    const { app, requestHooks } = stubApp(dbConfig)
    await new EloquentServiceProvider(app).register()
    expect(requestHooks).toHaveLength(0)
  })
})
