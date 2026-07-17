import { Collection } from '@elysia-ravel/support'
import { beforeEach, describe, expect, test } from 'bun:test'
import { setConnection } from '../src/connection'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'
import { dialects } from './dialects'

class User extends Model {
  static override guarded = []
  static override table = 'users'
  static override hidden = ['password']
  declare id: number
  declare name: string
  declare email: string
  declare password: string
}

for (const d of dialects) {
  describe(`Model (${d.name})`, () => {
    beforeEach(async () => {
      const conn = await d.connect()
      setConnection(conn)
      await new SchemaBuilder(conn).create('users', (t) => {
        t.id()
        t.string('name')
        t.string('email').unique()
        t.string('password')
        t.timestamps()
      })
    })

    test('create returns a persisted model with generated id + timestamps', async () => {
      const user = await User.create({ name: 'Ada', email: 'ada@x.com', password: 'secret' })
      expect(user.id).toBe(1)
      expect(user.name).toBe('Ada')
      expect(user.exists).toBe(true)
      expect(typeof user.getAttribute('created_at')).toBe('string')
    })

    test('hidden attributes are excluded from toJSON', async () => {
      const user = await User.create({ name: 'Ada', email: 'ada@x.com', password: 'secret' })
      expect((user.toJSON() as Record<string, unknown>).password).toBeUndefined()
      expect((user.toJSON() as Record<string, unknown>).name).toBe('Ada')
    })

    test('find / where / first / all return hydrated models', async () => {
      await User.create({ name: 'Ada', email: 'ada@x.com', password: 'x' })
      await User.create({ name: 'Alan', email: 'alan@x.com', password: 'x' })

      expect((await User.find(1))?.name).toBe('Ada')
      expect(await User.find(999)).toBeUndefined()
      expect((await User.where('email', 'alan@x.com').first())?.name).toBe('Alan')

      const all = await User.all()
      expect(all).toBeInstanceOf(Collection)
      expect(all.count()).toBe(2)
      expect(all.pluck('name').all()).toEqual(['Ada', 'Alan'])
    })

    test('save updates only dirty attributes; dirty tracking works', async () => {
      const user = await User.create({ name: 'Ada', email: 'ada@x.com', password: 'x' })
      expect(user.isDirty()).toBe(false)

      user.name = 'Ada Lovelace'
      expect(user.isDirty('name')).toBe(true)
      await user.save()
      expect(user.isDirty()).toBe(false)

      expect((await User.find(1))?.name).toBe('Ada Lovelace')
    })

    test('delete removes the row', async () => {
      const user = await User.create({ name: 'Ada', email: 'ada@x.com', password: 'x' })
      await user.delete()
      expect(user.exists).toBe(false)
      expect(await User.find(1)).toBeUndefined()
    })

    test('updateOrCreate updates when matched, creates otherwise', async () => {
      const a = await User.updateOrCreate({ email: 'ada@x.com' }, { name: 'Ada', password: 'x' })
      expect(a.id).toBe(1)
      const b = await User.updateOrCreate({ email: 'ada@x.com' }, { name: 'Ada L.' })
      expect(b.id).toBe(1) // same row updated
      expect((await User.find(1))?.name).toBe('Ada L.')
      expect(await User.query().count()).toBe(1)
    })

    test('firstOrCreate does not duplicate', async () => {
      await User.firstOrCreate({ email: 'ada@x.com' }, { name: 'Ada', password: 'x' })
      await User.firstOrCreate({ email: 'ada@x.com' }, { name: 'Nope', password: 'y' })
      expect(await User.query().count()).toBe(1)
    })
  })
}
