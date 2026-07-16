import { beforeEach, describe, expect, test } from 'bun:test'
import { createConnection, setConnection } from '../src/connection'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'

class Post extends Model {
  static override table = 'posts'
  static override timestamps = false
  declare id: number
  declare user_id: number
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
  describe(`has / doesntHave (${d.name})`, () => {
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
      })
      const ada = await User.create({ name: 'Ada' })
      const bob = await User.create({ name: 'Bob' })
      await User.create({ name: 'Cara' }) // no posts
      for (let i = 0; i < 3; i++) await Post.create({ user_id: ada.id })
      await Post.create({ user_id: bob.id })
    })

    const names = async (b: {
      get(): Promise<{ pluck(k: 'name'): { all(): string[] } }>
    }) => (await b.get()).pluck('name').all().sort()

    test('has / count operators', async () => {
      expect(await User.query().has('posts').count()).toBe(2)
      expect(await names(User.query().has('posts', '>', 2))).toEqual(['Ada'])
      expect(await User.query().has('posts', '>=', 1).count()).toBe(2)
    })

    test('doesntHave', async () => {
      expect(await names(User.query().doesntHave('posts'))).toEqual(['Cara'])
    })

    test('orWhereHas', async () => {
      expect(await names(User.query().where('name', 'Cara').orWhereHas('posts'))).toEqual([
        'Ada',
        'Bob',
        'Cara',
      ])
    })

    test('orWhereDoesntHave', async () => {
      expect(await names(User.query().where('name', 'Ada').orWhereDoesntHave('posts'))).toEqual([
        'Ada',
        'Cara',
      ])
    })
  })
}
