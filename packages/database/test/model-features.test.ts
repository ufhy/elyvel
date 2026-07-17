import type { EloquentBuilder } from '../src/eloquent-builder'
import { beforeEach, describe, expect, test } from 'bun:test'
import { setConnection, transaction } from '../src/connection'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'
import { dialects } from './dialects'

class Post extends Model {
  static override guarded = []
  static override table = 'posts'
  static override timestamps = false
  static override casts = {
    views: 'int',
    published_at: 'datetime',
    tags: {
      get: (v: unknown) => (v ? String(v).split(',') : []),
      set: (v: unknown) => (Array.isArray(v) ? v.join(',') : v),
    },
  } as const

  static override scopes = {
    published: (q: EloquentBuilder<Post>) => {
      q.where('status', 'published')
    },
  }

  declare id: number
  declare title: string
  declare views: number
  declare status: string
  declare published_at: Date
  declare tags: string[]
}

// Events registered once at module load; test clears the log before acting.
const events: string[] = []
class Auditable extends Model {
  static override guarded = []
  static override table = 'auditables'
  static override timestamps = false
  declare id: number
  declare name: string
}
for (const e of ['creating', 'created', 'saving', 'saved', 'deleting', 'deleted'] as const) {
  Auditable.on(e, () => {
    events.push(e)
  })
}

for (const d of dialects) {
  describe(`model features (${d.name})`, () => {
    beforeEach(async () => {
      const conn = await d.connect()
      setConnection(conn)
      const schema = new SchemaBuilder(conn)
      await schema.create('posts', (t) => {
        t.id()
        t.string('title')
        t.integer('views')
        t.string('status')
        t.timestamp('published_at').nullable()
        t.string('tags').nullable()
      })
      await schema.create('auditables', (t) => {
        t.id()
        t.string('name')
      })
    })

    test('transaction commits on success', async () => {
      await transaction(async () => {
        await Post.create({ title: 'A', views: 0, status: 'draft' })
        await Post.create({ title: 'B', views: 0, status: 'draft' })
      })
      expect(await Post.query().count()).toBe(2)
    })

    test('transaction rolls back on error', async () => {
      await expect(
        transaction(async () => {
          await Post.create({ title: 'A', views: 0, status: 'draft' })
          throw new Error('boom')
        }),
      ).rejects.toThrow('boom')
      expect(await Post.query().count()).toBe(0)
    })

    test('local scope', async () => {
      await Post.create({ title: 'A', views: 0, status: 'published' })
      await Post.create({ title: 'B', views: 0, status: 'draft' })
      expect(await Post.query().scope('published').count()).toBe(1)
    })

    test('date + custom casts round-trip', async () => {
      const when = new Date('2026-01-02T03:04:05.000Z')
      await Post.create({ title: 'A', views: 3, status: 'x', published_at: when, tags: ['a', 'b'] })
      const post = await Post.find(1)
      expect(post?.published_at).toBeInstanceOf(Date)
      expect(post?.published_at.toISOString()).toBe(when.toISOString())
      expect(post?.tags).toEqual(['a', 'b'])
    })

    test('refresh + fresh reload from DB', async () => {
      const post = await Post.create({ title: 'A', views: 0, status: 'x' })
      await Post.query().where('id', post.id).update({ title: 'Changed' })
      expect(post.title).toBe('A') // stale
      await post.refresh()
      expect(post.title).toBe('Changed')
      const fresh = await post.fresh()
      expect(fresh?.title).toBe('Changed')
    })

    test('model events fire in order', async () => {
      events.length = 0
      const a = await Auditable.create({ name: 'x' })
      await a.delete()
      expect(events).toEqual(['saving', 'creating', 'created', 'saved', 'deleting', 'deleted'])
    })
  })
}
