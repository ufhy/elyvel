import { beforeEach, describe, expect, test } from 'bun:test'
import { setConnection } from '../src/connection'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'
import { dialects } from './dialects'

class Item extends Model {
  static override guarded = []
  static override table = 'items'
  static override timestamps = false
  declare id: number
  declare n: number
}

for (const d of dialects) {
  describe(`pagination (${d.name})`, () => {
    beforeEach(async () => {
      const conn = await d.connect()
      setConnection(conn)
      await new SchemaBuilder(conn).create('items', (t) => {
        t.id()
        t.integer('n')
      })
      for (let i = 1; i <= 25; i++) await Item.create({ n: i })
    })

    test('paginate returns a page slice plus metadata', async () => {
      const page2 = await Item.query().orderBy('id').paginate(10, 2)
      expect(page2.total).toBe(25)
      expect(page2.perPage).toBe(10)
      expect(page2.currentPage).toBe(2)
      expect(page2.lastPage).toBe(3)
      expect(page2.data.count()).toBe(10)
      expect(page2.data.first()?.n).toBe(11) // second page starts at 11
    })

    test('last page returns the remainder', async () => {
      const page3 = await Item.query().orderBy('id').paginate(10, 3)
      expect(page3.data.count()).toBe(5)
      expect(page3.data.last()?.n).toBe(25)
    })

    test('pagination respects where constraints in the count', async () => {
      const page = await Item.query().where('n', '>', 20).orderBy('id').paginate(10, 1)
      expect(page.total).toBe(5)
      expect(page.data.count()).toBe(5)
    })
  })
}
