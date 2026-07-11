import { beforeEach, describe, expect, test } from 'bun:test'
import { createConnection, setConnection } from '../src/connection'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'

class Setting extends Model {
  static override table = 'settings'
  static override timestamps = false
  static override casts = { active: 'boolean', meta: 'json', count: 'int' } as const
  declare id: number
  declare active: boolean
  // biome-ignore lint/suspicious/noExplicitAny: exercising json cast with mixed shapes
  declare meta: any
  declare count: number
}

const dialects = [
  { name: 'sqlite', connect: () => createConnection({ driver: 'sqlite', database: ':memory:' }) },
  { name: 'pglite', connect: () => createConnection({ driver: 'pglite' }) },
] as const

for (const d of dialects) {
  describe(`casts (${d.name})`, () => {
    beforeEach(async () => {
      const conn = await d.connect()
      setConnection(conn)
      await new SchemaBuilder(conn).create('settings', (t) => {
        t.id()
        t.boolean('active')
        t.json('meta')
        t.integer('count')
      })
    })

    test('casts apply on read after a round-trip through the database', async () => {
      await Setting.create({ active: true, meta: { theme: 'dark', n: 2 }, count: '5' })

      const row = await Setting.find(1)
      expect(row?.active).toBe(true) // boolean, not 0/1
      expect(row?.meta).toEqual({ theme: 'dark', n: 2 }) // parsed object, not string
      expect(row?.count).toBe(5) // number, not "5"
    })

    test('false / falsy round-trips correctly', async () => {
      await Setting.create({ active: false, meta: [], count: 0 })
      const row = await Setting.find(1)
      expect(row?.active).toBe(false)
      expect(row?.meta).toEqual([])
      expect(row?.count).toBe(0)
    })

    test('toJSON emits casted values', async () => {
      await Setting.create({ active: true, meta: { a: 1 }, count: 3 })
      const json = (await Setting.find(1))?.toJSON() as Record<string, unknown>
      expect(json.active).toBe(true)
      expect(json.meta).toEqual({ a: 1 })
      expect(json.count).toBe(3)
    })
  })
}
