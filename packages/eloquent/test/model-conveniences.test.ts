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

class Token extends Model {
  static override table = 'tokens'
  static override timestamps = false
  static override primaryKey = 'id'
  static override usesUniqueIds = true
  static override fillable = ['label']
  declare id: string
  declare label: string
}

const dialects = [
  { name: 'sqlite', connect: () => createConnection({ driver: 'sqlite', database: ':memory:' }) },
  { name: 'pglite', connect: () => createConnection({ driver: 'pglite' }) },
] as const

for (const d of dialects) {
  describe(`model conveniences (${d.name})`, () => {
    beforeEach(async () => {
      const conn = await d.connect()
      setConnection(conn)
      await new SchemaBuilder(conn).create('posts', (t) => {
        t.id()
        t.string('title')
        t.integer('views').default(0)
        t.timestamps()
      })
      await new SchemaBuilder(conn).create('tokens', (t) => {
        t.uuid('id')
        t.string('label')
      })
    })

    test('findMany + whereKey', async () => {
      await Post.create({ title: 'a', views: 1 })
      await Post.create({ title: 'b', views: 2 })
      await Post.create({ title: 'c', views: 3 })

      const many = await Post.findMany([1, 3])
      expect([...many].map((p) => p.title).sort()).toEqual(['a', 'c'])

      const byKey = await Post.whereKey([2, 3]).get()
      expect(byKey.count()).toBe(2)
    })

    test('sole() returns one, throws otherwise', async () => {
      await Post.create({ title: 'only', views: 0 })
      await Post.create({ title: 'dup', views: 0 })
      await Post.create({ title: 'dup', views: 0 })

      expect((await Post.where('title', 'only').sole()).title).toBe('only')
      await expect(Post.where('title', 'dup').sole()).rejects.toThrow(/multiple/)
      await expect(Post.where('title', 'none').sole()).rejects.toThrow(/no records/)
    })

    test('replicate() copies attributes without key/timestamps', async () => {
      const original = await Post.create({ title: 'orig', views: 5 })
      const copy = original.replicate()
      expect(copy.exists).toBe(false)
      expect(copy.getAttribute('id')).toBeUndefined()
      expect(copy.title).toBe('orig')
      await copy.save()
      expect(copy.id).toBeGreaterThan(original.id)
    })

    test('touch() bumps updated_at', async () => {
      const post = await Post.create({ title: 't', views: 0 })
      const before = post.getAttribute('updated_at')
      await new Promise((r) => setTimeout(r, 5))
      await post.touch()
      expect(post.getAttribute('updated_at')).not.toBe(before)
    })

    test('withoutTimestamps skips created_at/updated_at', async () => {
      const post = await Post.withoutTimestamps(async () => Post.create({ title: 'nt', views: 0 }))
      expect(post.getAttribute('created_at')).toBeNull() // not auto-set → DB default (null)
    })

    test('usesUniqueIds auto-generates a UUID primary key', async () => {
      const token = await Token.create({ label: 'api' })
      expect(typeof token.id).toBe('string')
      expect(token.id).toMatch(/^[0-9a-f-]{36}$/)
      expect((await Token.find(token.id))?.label).toBe('api')
    })
  })
}
