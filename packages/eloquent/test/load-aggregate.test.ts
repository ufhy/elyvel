import { beforeEach, describe, expect, test } from 'bun:test'
import { createConnection, setConnection } from '../src/connection'
import type { EloquentCollection } from '../src/eloquent-collection'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'

class Post extends Model {
  static override table = 'posts'
  static override timestamps = false
  declare id: number
  declare user_id: number
  declare votes: number
}
class User extends Model {
  static override table = 'users'
  static override timestamps = false
  declare id: number
  declare name: string
  posts() {
    return this.hasMany(Post)
  }
}

const dialects = [
  { name: 'sqlite', connect: () => createConnection({ driver: 'sqlite', database: ':memory:' }) },
  { name: 'pglite', connect: () => createConnection({ driver: 'pglite' }) },
] as const

for (const d of dialects) {
  describe(`load + relation aggregates (${d.name})`, () => {
    beforeEach(async () => {
      const conn = await d.connect()
      setConnection(conn)
      const schema = new SchemaBuilder(conn)
      await schema.create('users', (t) => {
        t.id()
        t.string('name')
      })
      await schema.create('posts', (t) => {
        t.id()
        t.integer('user_id')
        t.integer('votes')
      })
      const ada = await User.create({ name: 'Ada' })
      const bob = await User.create({ name: 'Bob' })
      await Post.create({ user_id: ada.id, votes: 10 })
      await Post.create({ user_id: ada.id, votes: 20 })
      await Post.create({ user_id: bob.id, votes: 5 })
    })

    test('withSum / withAvg / withMax / withMin', async () => {
      const ada = await User.query()
        .withSum('posts', 'votes')
        .withAvg('posts', 'votes')
        .withMax('posts', 'votes')
        .withMin('posts', 'votes')
        .where('name', 'Ada')
        .first()
      expect(ada?.getAttribute('posts_sum_votes')).toBe(30)
      expect(ada?.getAttribute('posts_avg_votes')).toBe(15)
      expect(ada?.getAttribute('posts_max_votes')).toBe(20)
      expect(ada?.getAttribute('posts_min_votes')).toBe(10)
    })

    test('Model.load / loadMissing after fetch', async () => {
      const ada = await User.where('name', 'Ada').first()
      expect(ada?.getRelation('posts')).toBeUndefined()
      await ada?.load('posts')
      expect(ada?.getRelation<EloquentCollection<Post>>('posts').count()).toBe(2)
      // loadMissing skips already-loaded
      await ada?.loadMissing('posts')
      expect(ada?.getRelation<EloquentCollection<Post>>('posts').count()).toBe(2)
    })

    test('EloquentCollection.load populates all', async () => {
      const users = await User.query().orderBy('id').get()
      await users.load('posts')
      expect(users.get(0)?.getRelation<EloquentCollection<Post>>('posts').count()).toBe(2)
      expect(users.get(1)?.getRelation<EloquentCollection<Post>>('posts').count()).toBe(1)
    })
  })
}
