import { beforeEach, describe, expect, test } from 'bun:test'
import { createConnection, setConnection, useConnection } from '../src/connection'
import { defineFactory } from '../src/factory'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'
import { dialects } from './dialects'

class Item extends Model {
  static override table = 'items'
  static override timestamps = false
  declare id: number
  declare n: number
}
const itemFactory = defineFactory(Item, i => ({ n: i }))

for (const d of dialects) {
  describe(`cursor + factory (${d.name})`, () => {
    beforeEach(async () => {
      const conn = await d.connect()
      setConnection(conn)
      await new SchemaBuilder(conn).create('items', (t) => {
        t.id()
        t.integer('n')
      })
    })

    test('factory create/make', async () => {
      const created = await itemFactory().count(5).create()
      expect(created).toHaveLength(5)
      expect(await Item.query().count()).toBe(5)

      const made = itemFactory().count(2).make() // unsaved
      expect(made).toHaveLength(2)
      expect(made[0]?.exists).toBe(false)
      expect(await Item.query().count()).toBe(5) // make did not persist

      const one = await itemFactory().createOne({ n: 99 })
      expect(one.n).toBe(99)
    })

    test('cursor streams lazily', async () => {
      await itemFactory().count(5).create()
      const collected: number[] = []
      await Item.query()
        .orderBy('id')
        .cursor(2)
        .each((item) => {
          collected.push(item.n)
        })
      expect(collected).toHaveLength(5)

      const firstThree = await Item.query().orderBy('id').cursor(2).take(3).toArray()
      expect(firstThree).toHaveLength(3)
    })
  })
}

describe('multiple connections', () => {
  class Main extends Model {
    static override table = 'mains'
    static override timestamps = false
    declare id: number
    declare label: string
  }
  class Report extends Model {
    static override table = 'reports'
    static override timestamps = false
    static override connection = 'analytics'
    declare id: number
    declare metric: string
  }

  beforeEach(async () => {
    const primary = await createConnection({ driver: 'sqlite', database: ':memory:' })
    const analytics = await createConnection({ driver: 'pglite' })
    setConnection(primary) // default
    setConnection(analytics, 'analytics')
    await new SchemaBuilder(primary).create('mains', (t) => {
      t.id()
      t.string('label')
    })
    await new SchemaBuilder(analytics).create('reports', (t) => {
      t.id()
      t.string('metric')
    })
  })

  test('a model uses its named connection', async () => {
    await Main.create({ label: 'x' })
    await Report.create({ metric: 'y' })

    expect(await Main.query().count()).toBe(1)
    expect(await Report.query().count()).toBe(1)

    // The reports table lives only in the analytics (pglite) connection.
    const rows = await useConnection('analytics').select<{ c: number | string }>(
      'SELECT COUNT(*) AS c FROM reports',
    )
    expect(Number(rows[0]?.c)).toBe(1)
  })
})
