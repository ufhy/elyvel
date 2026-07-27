import { runWithActor } from '@elyvel/core'
import { beforeEach, describe, expect, test } from 'bun:test'
import { setConnection } from '../src/connection'
import { hasColumn } from '../src/inspect'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'
import { dialects } from './dialects'

class Post extends Model {
  static override guarded = []
  static override table = 'posts'
  static override softDeletes = true
  static override userstamps = true
  declare id: number
  declare title: string
}

class AppUser extends Model {
  static override guarded = []
  static override table = 'users'
  static override timestamps = false
  declare id: string
}

for (const d of dialects) {
  describe(`userstamps (${d.name})`, () => {
    beforeEach(async () => {
      const conn = await d.connect()
      setConnection(conn)
      const schema = new SchemaBuilder(conn)
      await schema.create('users', (t) => {
        t.string('id').unique()
        t.string('name')
      })
      await schema.create('posts', (t) => {
        t.id()
        t.string('title')
        t.timestamps()
        t.softDeletes()
        t.userstamps()
      })
      await AppUser.create({ id: 'user-1', name: 'Ada' })
      await AppUser.create({ id: 'user-2', name: 'Grace' })
    })

    test('create() sets created_by + updated_by from the current actor', async () => {
      const post = await runWithActor('user-1', () => Post.create({ title: 'Hi' }))
      expect(post.getAttribute('created_by')).toBe('user-1')
      expect(post.getAttribute('updated_by')).toBe('user-1')
    })

    test('save() on update only re-stamps updated_by, not created_by', async () => {
      const post = await runWithActor('user-1', () => Post.create({ title: 'Hi' }))
      await runWithActor('user-2', async () => {
        post.title = 'Edited'
        await post.save()
      })
      expect(post.getAttribute('created_by')).toBe('user-1')
      expect(post.getAttribute('updated_by')).toBe('user-2')
    })

    test('outside any actor scope, the columns are left null — no error', async () => {
      const post = await Post.create({ title: 'No actor' })
      expect(post.getAttribute('created_by')).toBeNull()
      expect(post.getAttribute('updated_by')).toBeNull()
    })

    test('delete() (soft) sets deleted_by; restore() clears it', async () => {
      const post = await runWithActor('user-1', () => Post.create({ title: 'Hi' }))
      await runWithActor('user-2', () => post.delete())
      expect(post.trashed()).toBe(true)
      expect(post.getAttribute('deleted_by')).toBe('user-2')

      await post.restore()
      expect(post.trashed()).toBe(false)
      expect(post.getAttribute('deleted_by')).toBeNull()
    })

    test('a model with userstamps = false (the default) never touches these columns', async () => {
      class PlainPost extends Model {
        static override guarded = []
        static override table = 'posts'
        declare id: number
      }
      const post = await runWithActor('user-1', () => PlainPost.create({ title: 'Untouched' }))
      expect(post.getAttribute('created_by')).toBeNull()
    })

    test('created_by is a real FK to users(id), enforced by the database', async () => {
      await expect(
        Post.create({ title: 'Bad FK', created_by: 'no-such-user' } as any),
      ).rejects.toThrow()
    })
  })
}

describe('Blueprint.userstamps()/dropUserstamps() (schema only, dialect-specific behavior)', () => {
  for (const d of dialects) {
    test(`(${d.name}) userstamps() creates 3 nullable FK columns`, async () => {
      const conn = await d.connect()
      const schema = new SchemaBuilder(conn)
      await schema.create('users', (t) => {
        t.string('id').unique()
      })
      await schema.create('widgets', (t) => {
        t.id()
        t.userstamps()
      })
      for (const col of ['created_by', 'updated_by', 'deleted_by'])
        expect(await hasColumn(conn, 'widgets', col)).toBe(true)
    })

    if (d.name === 'sqlite') {
      test('(sqlite) dropUserstamps() throws a clear error instead of a raw SQLite one', async () => {
        const conn = await d.connect()
        const schema = new SchemaBuilder(conn)
        await schema.create('users', t => t.string('id').unique())
        await schema.create('widgets', (t) => {
          t.id()
          t.userstamps()
        })
        await expect(
          schema.table('widgets', t => t.dropUserstamps()),
        ).rejects.toThrow(/not supported on SQLite/)
      })
    }
    else {
      test(`(${d.name}) dropUserstamps() actually drops the columns (incl. the FK constraint first, if any)`, async () => {
        const conn = await d.connect()
        const schema = new SchemaBuilder(conn)
        await schema.create('users', t => t.string('id').unique())
        await schema.create('widgets', (t) => {
          t.id()
          t.userstamps()
        })
        await schema.table('widgets', t => t.dropUserstamps())
        for (const col of ['created_by', 'updated_by', 'deleted_by'])
          expect(await hasColumn(conn, 'widgets', col)).toBe(false)
      })
    }
  }
})
