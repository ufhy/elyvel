import { beforeEach, describe, expect, test } from 'bun:test'
import { createConnection, setConnection } from '../src/connection'
import { SchemaBuilder } from '../src/schema'
import { table } from '../src/query-builder'

describe('query builder — multiple connections', () => {
  beforeEach(async () => {
    const main = await createConnection({ driver: 'sqlite', database: ':memory:' })
    const analytics = await createConnection({ driver: 'sqlite', database: ':memory:' })
    setConnection(main, 'default')
    setConnection(analytics, 'analytics')

    await new SchemaBuilder(main).create('users', (t) => {
      t.id()
      t.string('name')
    })
    await new SchemaBuilder(analytics).create('events', (t) => {
      t.id()
      t.string('kind')
    })
    await table('users').insert({ name: 'Ada' })
    await table('events', 'analytics').insertMany([{ kind: 'click' }, { kind: 'view' }])
  })

  test('table(name) uses the default connection; table(name, conn) targets a named one', async () => {
    expect(await table('users').count()).toBe(1)
    expect(await table('events', 'analytics').count()).toBe(2)
  })

  test('the wrong connection cannot see the other connection’s tables', async () => {
    await expect(table('events').get()).rejects.toThrow() // no `events` on default
    await expect(table('users', 'analytics').get()).rejects.toThrow() // no `users` on analytics
  })
})

describe('query builder — whereJsonContains (sqlite)', () => {
  test('matches a scalar inside a JSON array column', async () => {
    const conn = await createConnection({ driver: 'sqlite', database: ':memory:' })
    setConnection(conn)
    await new SchemaBuilder(conn).create('docs', (t) => {
      t.id()
      t.json('tags')
    })
    await table('docs').insert({ id: 1, tags: JSON.stringify(['a', 'b']) })
    await table('docs').insert({ id: 2, tags: JSON.stringify(['c']) })

    const withA = await table('docs').whereJsonContains('tags', 'a').get()
    expect(withA.map((r) => r.id)).toEqual([1])
    await conn.close()
  })
})
