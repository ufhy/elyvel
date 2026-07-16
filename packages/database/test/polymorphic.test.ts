import type { EloquentCollection } from '../src/eloquent-collection'
import { beforeEach, describe, expect, test } from 'bun:test'
import { createConnection, setConnection } from '../src/connection'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'

class Comment extends Model {
  static override table = 'comments'
  static override timestamps = false
  declare id: number
  declare commentable_id: number
  declare commentable_type: string
  declare body: string
  commentable() {
    return this.morphTo('commentable', { Post, Video })
  }
}
class Post extends Model {
  static override table = 'posts'
  static override timestamps = false
  declare id: number
  declare title: string
  comments() {
    return this.morphMany(Comment, 'commentable')
  }
}
class Video extends Model {
  static override table = 'videos'
  static override timestamps = false
  declare id: number
  declare title: string
}
class Book extends Model {
  static override table = 'books'
  static override timestamps = false
  declare id: number
  declare author_id: number
  declare title: string
}
class Author extends Model {
  static override table = 'authors'
  static override timestamps = false
  declare id: number
  declare country_id: number
}
class Country extends Model {
  static override table = 'countries'
  static override timestamps = false
  declare id: number
  declare name: string
  books() {
    return this.hasManyThrough(Book, Author)
  }
}

const dialects = [
  { name: 'sqlite', connect: () => createConnection({ driver: 'sqlite', database: ':memory:' }) },
  { name: 'pglite', connect: () => createConnection({ driver: 'pglite' }) },
] as const

for (const d of dialects) {
  describe(`polymorphic + through (${d.name})`, () => {
    beforeEach(async () => {
      const conn = await d.connect()
      setConnection(conn)
      const schema = new SchemaBuilder(conn)
      await schema.create('posts', (t) => {
        t.id()
        t.string('title')
      })
      await schema.create('videos', (t) => {
        t.id()
        t.string('title')
      })
      await schema.create('comments', (t) => {
        t.id()
        t.integer('commentable_id')
        t.string('commentable_type')
        t.string('body')
      })
      await schema.create('countries', (t) => {
        t.id()
        t.string('name')
      })
      await schema.create('authors', (t) => {
        t.id()
        t.integer('country_id')
      })
      await schema.create('books', (t) => {
        t.id()
        t.integer('author_id')
        t.string('title')
      })
    })

    test('morphMany + morphTo', async () => {
      const post = await Post.create({ title: 'P' })
      const video = await Video.create({ title: 'V' })
      await Comment.create({ commentable_id: post.id, commentable_type: 'Post', body: 'a' })
      await Comment.create({ commentable_id: post.id, commentable_type: 'Post', body: 'b' })
      await Comment.create({ commentable_id: video.id, commentable_type: 'Video', body: 'c' })

      expect((await post.comments().get()).count()).toBe(2)

      const comment = await Comment.find(1)
      const owner = await comment?.commentable().first()
      expect((owner as Post | undefined)?.title).toBe('P')
    })

    test('morphTo eager loading resolves each type', async () => {
      const post = await Post.create({ title: 'P' })
      const video = await Video.create({ title: 'V' })
      await Comment.create({ commentable_id: post.id, commentable_type: 'Post', body: 'a' })
      await Comment.create({ commentable_id: video.id, commentable_type: 'Video', body: 'c' })

      const comments = await Comment.query().with('commentable').orderBy('id').get()
      expect((comments.get(0)!.getRelation('commentable') as Post).title).toBe('P')
      expect((comments.get(1)!.getRelation('commentable') as Video).title).toBe('V')
    })

    test('hasManyThrough', async () => {
      const country = await Country.create({ name: 'US' })
      const a1 = await Author.create({ country_id: country.id })
      const a2 = await Author.create({ country_id: country.id })
      await Book.create({ author_id: a1.id, title: 'B1' })
      await Book.create({ author_id: a1.id, title: 'B2' })
      await Book.create({ author_id: a2.id, title: 'B3' })
      await Book.create({ author_id: 999, title: 'Other' })

      const books = await country.books().get()
      expect(books.count()).toBe(3)

      const eager = await Country.query().with('books').get()
      expect(eager.first()?.getRelation<EloquentCollection<Book>>('books').count()).toBe(3)
    })
  })
}
