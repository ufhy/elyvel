import { beforeEach, describe, expect, test } from 'bun:test'
import { createConnection, setConnection } from '../src/connection'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'

class History extends Model {
  static override table = 'histories'
  static override timestamps = false
  declare id: number
  declare user_id: number
  declare note: string
}
class SupplierUser extends Model {
  static override table = 'users'
  static override timestamps = false
  declare id: number
  declare supplier_id: number
}
class Supplier extends Model {
  static override table = 'suppliers'
  static override timestamps = false
  declare id: number
  history() {
    return this.hasOneThrough(History, SupplierUser, 'supplier_id', 'user_id')
  }
}

class Tag extends Model {
  static override table = 'tags'
  static override timestamps = false
  declare id: number
  declare name: string
  posts() {
    return this.morphedByMany(Post, 'taggable')
  }
}
class Post extends Model {
  static override table = 'posts'
  static override timestamps = false
  declare id: number
  declare title: string
  tags() {
    return this.morphToMany(Tag, 'taggable')
  }
}
class Video extends Model {
  static override table = 'videos'
  static override timestamps = false
  declare id: number
  tags() {
    return this.morphToMany(Tag, 'taggable')
  }
}

const dialects = [
  { name: 'sqlite', connect: () => createConnection({ driver: 'sqlite', database: ':memory:' }) },
  { name: 'pglite', connect: () => createConnection({ driver: 'pglite' }) },
] as const

for (const d of dialects) {
  describe(`through + morph-many-to-many (${d.name})`, () => {
    beforeEach(async () => {
      const conn = await d.connect()
      setConnection(conn)
      const s = new SchemaBuilder(conn)
      await s.create('suppliers', (t) => t.id())
      await s.create('users', (t) => {
        t.id()
        t.integer('supplier_id')
      })
      await s.create('histories', (t) => {
        t.id()
        t.integer('user_id')
        t.string('note')
      })
      await s.create('tags', (t) => {
        t.id()
        t.string('name')
      })
      await s.create('posts', (t) => {
        t.id()
        t.string('title')
      })
      await s.create('videos', (t) => t.id())
      await s.create('taggables', (t) => {
        t.integer('tag_id')
        t.integer('taggable_id')
        t.string('taggable_type')
      })
    })

    test('hasOneThrough', async () => {
      const supplier = await Supplier.create({})
      const user = await SupplierUser.create({ supplier_id: supplier.id })
      await History.create({ user_id: user.id, note: 'hi' })
      const history = await supplier.history().first()
      expect(history?.note).toBe('hi')
    })

    test('morphToMany + morphedByMany + type isolation', async () => {
      const post = await Post.create({ title: 'P' })
      const video = await Video.create({})
      const tag = await Tag.create({ name: 'featured' })

      await post.tags().attach(tag.id)
      await video.tags().attach(tag.id)

      expect((await post.tags().get()).first()?.name).toBe('featured')
      // inverse: tag.posts() only Post-typed pivot rows, not the Video
      const posts = await tag.posts().get()
      expect(posts.count()).toBe(1)
      expect(posts.first()?.title).toBe('P')
    })
  })
}
