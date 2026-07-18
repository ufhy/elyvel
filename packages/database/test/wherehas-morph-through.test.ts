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
  declare title: string
}
class Video extends Model {
  static override guarded = []
  static override table = 'videos'
  static override timestamps = false
  declare id: number
  declare title: string
}
class Comment extends Model {
  static override guarded = []
  static override table = 'comments'
  static override timestamps = false
  declare id: number
  declare commentable_id: number
  declare commentable_type: string
  commentable() {
    return this.morphTo('commentable', { Post, Video })
  }
}
class Book extends Model {
  static override guarded = []
  static override table = 'books'
  static override timestamps = false
  declare id: number
  declare author_id: number
  declare title: string
}
class Author extends Model {
  static override guarded = []
  static override table = 'authors'
  static override timestamps = false
  declare id: number
  declare country_id: number
}
class Country extends Model {
  static override guarded = []
  static override table = 'countries'
  static override timestamps = false
  declare id: number
  declare name: string
  books() {
    return this.hasManyThrough(Book, Author)
  }
}

for (const d of dialects) {
  describe(`whereHasMorph + hasManyThrough whereHas (${d.name})`, () => {
    beforeEach(async () => {
      const conn = await d.connect()
      setConnection(conn)
      const s = new SchemaBuilder(conn)
      await s.create('posts', (t) => {
        t.id()
        t.string('title')
      })
      await s.create('videos', (t) => {
        t.id()
        t.string('title')
      })
      await s.create('comments', (t) => {
        t.id()
        t.integer('commentable_id')
        t.string('commentable_type')
      })
      await s.create('countries', (t) => {
        t.id()
        t.string('name')
      })
      await s.create('authors', (t) => {
        t.id()
        t.integer('country_id')
      })
      await s.create('books', (t) => {
        t.id()
        t.integer('author_id')
        t.string('title')
      })

      await Post.create({ id: 1, title: 'Published' })
      await Post.create({ id: 2, title: 'Draft' })
      await Video.create({ id: 1, title: 'Clip' })
      await Comment.create({ commentable_type: 'Post', commentable_id: 1 }) // → Published post
      await Comment.create({ commentable_type: 'Post', commentable_id: 2 }) // → Draft post
      await Comment.create({ commentable_type: 'Video', commentable_id: 1 }) // → video
    })

    test('whereHasMorph filters by the morph target type', async () => {
      const onPosts = await Comment.query().whereHasMorph('commentable', [Post]).orderBy('id').get()
      expect(onPosts.pluck('id').all()).toEqual([1, 2]) // the two Post comments, not the Video one
    })

    test('whereHasMorph applies the constraint to the target', async () => {
      const published = await Comment.query()
        .whereHasMorph('commentable', [Post], q => q.where('title', 'Published'))
        .get()
      expect(published.pluck('id').all()).toEqual([1]) // only the comment on the Published post
    })

    test('whereDoesntHaveMorph negates it', async () => {
      // comments whose commentable is NOT a Post titled "Published"
      const rest = await Comment.query()
        .whereDoesntHaveMorph('commentable', [Post], q => q.where('title', 'Published'))
        .orderBy('id')
        .get()
      expect(rest.pluck('id').all()).toEqual([2, 3])
    })

    test('hasManyThrough supports whereHas (+ constraint)', async () => {
      // Country 1 → Author 1 → Book "B1"; Country 2 → Author 2 → no books.
      await Country.create({ id: 1, name: 'ID' })
      await Country.create({ id: 2, name: 'US' })
      await Author.create({ id: 1, country_id: 1 })
      await Author.create({ id: 2, country_id: 2 })
      await Book.create({ author_id: 1, title: 'B1' })

      const withBooks = await Country.query().whereHas('books').orderBy('id').get()
      expect(withBooks.pluck('name').all()).toEqual(['ID'])

      const matching = await Country.query().whereHas('books', q => q.where('title', 'B1')).get()
      expect(matching.pluck('name').all()).toEqual(['ID'])

      const none = await Country.query().whereHas('books', q => q.where('title', 'ZZZ')).get()
      expect(none.count()).toBe(0)
    })
  })
}
