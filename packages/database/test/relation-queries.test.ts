import type { EloquentCollection } from '../src/eloquent-collection'
import { beforeEach, describe, expect, test } from 'bun:test'
import { setConnection } from '../src/connection'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'
import { dialects } from './dialects'

class Comment extends Model {
  static override guarded = []
  static override table = 'comments'
  static override timestamps = false
  declare id: number
  declare post_id: number
  declare body: string
}
class Post extends Model {
  static override guarded = []
  static override table = 'posts'
  static override timestamps = false
  declare id: number
  declare user_id: number
  declare title: string
  comments() {
    return this.hasMany(Comment)
  }
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
  describe(`relation queries (${d.name})`, () => {
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
        t.string('title')
      })
      await schema.create('comments', (t) => {
        t.id()
        t.integer('post_id')
        t.string('body')
      })
      const ada = await User.create({ name: 'Ada' })
      await User.create({ name: 'Alan' }) // no posts
      const p1 = await Post.create({ user_id: ada.id, title: 'A1' })
      await Post.create({ user_id: ada.id, title: 'A2' })
      await Comment.create({ post_id: p1.id, body: 'nice' })
      await Comment.create({ post_id: p1.id, body: 'great' })
    })

    test('withCount adds <relation>_count', async () => {
      const users = await User.query().withCount('posts').orderBy('id').get()
      expect(users.get(0)?.getAttribute('posts_count')).toBe(2)
      expect(users.get(1)?.getAttribute('posts_count')).toBe(0)
    })

    test('whereHas filters to rows having the relation', async () => {
      const withPosts = await User.query().whereHas('posts').get()
      expect(withPosts.count()).toBe(1)
      expect(withPosts.first()?.name).toBe('Ada')
    })

    test('whereHas with a constraint', async () => {
      const matched = await User.query()
        .whereHas('posts', q => q.where('title', 'A1'))
        .get()
      expect(matched.count()).toBe(1)
      const none = await User.query()
        .whereHas('posts', q => q.where('title', 'nonexistent'))
        .get()
      expect(none.count()).toBe(0)
    })

    test('nested eager loading (posts.comments)', async () => {
      const users = await User.query().with('posts.comments').orderBy('id').get()
      const posts = users.first()?.getRelation<EloquentCollection<Post>>('posts')
      const firstPost = posts?.first()
      expect(firstPost?.getRelation<EloquentCollection<Comment>>('comments').count()).toBe(2)
    })

    test('constrained eager loading', async () => {
      const users = await User.query()
        .with({ posts: q => q.where('title', 'A1') })
        .orderBy('id')
        .get()
      expect(users.first()?.getRelation<EloquentCollection<Post>>('posts').count()).toBe(1)
    })
  })
}
