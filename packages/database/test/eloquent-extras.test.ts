import { beforeEach, describe, expect, test } from 'bun:test'
import { createConnection, setConnection } from '../src/connection'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'

class Post extends Model {
  static override table = 'posts'
  declare id: number
  declare title: string
  declare views: number
}

const dialects = [
  { name: 'sqlite', connect: () => createConnection({ driver: 'sqlite', database: ':memory:' }) },
  { name: 'pglite', connect: () => createConnection({ driver: 'pglite' }) },
] as const

for (const d of dialects) {
  describe(`eloquent extras (${d.name})`, () => {
    beforeEach(async () => {
      const conn = await d.connect()
      setConnection(conn)
      await new SchemaBuilder(conn).create('posts', (t) => {
        t.id()
        t.string('title')
        t.integer('views').default(0)
        t.timestamps()
      })
    })

    test('firstWhere / findOr / findOrNew / firstOrNew', async () => {
      await Post.create({ title: 'a', views: 1 })
      expect((await Post.firstWhere('title', 'a'))?.title).toBe('a')

      expect(await Post.findOr(999, () => 'missing')).toBe('missing')

      const neu = await Post.findOrNew(999)
      expect(neu.exists).toBe(false)

      const fon = await Post.firstOrNew({ title: 'ghost' }, { views: 7 })
      expect(fon.exists).toBe(false)
      expect(fon.title).toBe('ghost')
      expect(fon.views).toBe(7)
    })

    test('createMany / destroy / whereKeyNot', async () => {
      const many = await Post.createMany([{ title: 'x' }, { title: 'y' }, { title: 'z' }])
      expect(many.count()).toBe(3)

      const others = await Post.whereKeyNot(1).get()
      expect(others.count()).toBe(2)

      const deleted = await Post.destroy(1, 2)
      expect(deleted).toBe(2)
      expect(await Post.query().count()).toBe(1)
    })

    test('is / isNot', async () => {
      const p = await Post.create({ title: 'p' })
      const same = await Post.find(p.id)
      expect(p.is(same)).toBe(true)
      const other = await Post.create({ title: 'o' })
      expect(p.isNot(other)).toBe(true)
    })

    test('getOriginal / wasChanged / getChanges', async () => {
      const p = await Post.create({ title: 'orig', views: 1 })
      p.title = 'changed'
      await p.save()
      expect(p.getOriginal('title')).toBe('changed') // original updated after save
      expect(p.wasChanged('title')).toBe(true)
      expect(p.wasChanged('views')).toBe(false)
      expect(p.getChanges()).toHaveProperty('title', 'changed')
    })

    test('append + toArray', async () => {
      class Widget extends Model {
        static override table = 'posts'
        static override accessors = { slug: (m: Model) => `post-${m.getAttribute('id')}` }
        declare id: number
      }
      const w = await Widget.create({ title: 'w' })
      const json = w.append('slug').toArray()
      expect(json.slug).toBe(`post-${w.getAttribute('id')}`)
    })
  })
}

describe('unguard + custom timestamp columns (sqlite)', () => {
  test('unguard bypasses fillable; reguard restores', async () => {
    const conn = await createConnection({ driver: 'sqlite', database: ':memory:' })
    setConnection(conn)
    await new SchemaBuilder(conn).create('items', (t) => {
      t.id()
      t.string('name')
    })
    class Item extends Model {
      static override table = 'items'
      static override fillable = ['name']
      declare id: number
      declare name: string
    }
    Item.unguard()
    const i = new Item()
    i.fill({ name: 'ok', id: 99 } as never) // id normally guarded
    expect(i.getAttribute('id')).toBe(99)
    Item.reguard()
    await conn.close()
  })
})
