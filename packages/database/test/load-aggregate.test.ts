import type { EloquentCollection } from '../src/eloquent-collection'
import { beforeEach, describe, expect, test } from 'bun:test'
import { setConnection } from '../src/connection'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'
import { dialects } from './dialects'

class Post extends Model {
  static override guarded = []
  static override table = 'posts'
  static override timestamps = false
  declare id: number
  declare user_id: number
  declare votes: number
}
class User extends Model {
  static override guarded = []
  static override table = 'users'
  static override timestamps = false
  declare id: number
  declare name: string
  posts() {
    return this.hasMany(Post)
  }
}

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

    test('withCount adds <relation>_count without keeping the loaded relation around', async () => {
      const users = await User.query().withCount('posts').orderBy('id').get()
      expect(users.get(0)?.getAttribute('posts_count')).toBe(2)
      expect(users.get(1)?.getAttribute('posts_count')).toBe(1)
      // withCount is meant to be lightweight — the relation itself isn't kept loaded
      expect(users.get(0)?.getRelation('posts')).toBeUndefined()
    })

    test('Model.loadCount() adds <relation>_count to an already-fetched instance', async () => {
      const ada = await User.where('name', 'Ada').first()
      expect(ada?.getAttribute('posts_count')).toBeUndefined()
      await ada?.loadCount('posts')
      expect(ada?.getAttribute('posts_count')).toBe(2)
    })

    test('EloquentCollection.loadCount() adds <relation>_count to every model', async () => {
      const users = await User.query().orderBy('id').get()
      await users.loadCount('posts')
      expect(users.get(0)?.getAttribute('posts_count')).toBe(2)
      expect(users.get(1)?.getAttribute('posts_count')).toBe(1)
    })
  })
}
