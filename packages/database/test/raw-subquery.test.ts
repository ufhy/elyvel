import type { Connection } from '../src/connection'
import { beforeEach, describe, expect, test } from 'bun:test'
import { raw, setConnection } from '../src/connection'
import { Model } from '../src/model'
import { QueryBuilder } from '../src/query-builder'
import { SchemaBuilder } from '../src/schema'
import { dialects } from './dialects'

class Post extends Model {
  static override table = 'posts'
  static override timestamps = false
  declare id: number
  declare user_id: number
  declare title: string
}
class User extends Model {
  static override table = 'users'
  static override timestamps = false
  declare id: number
  declare name: string
  declare age: number
}

for (const d of dialects) {
  describe(`raw + subquery (${d.name})`, () => {
    let conn: Connection
    beforeEach(async () => {
      conn = await d.connect()
      setConnection(conn)
      const schema = new SchemaBuilder(conn)
      await schema.create('users', (t) => {
        t.id()
        t.string('name')
        t.integer('age')
      })
      await schema.create('posts', (t) => {
        t.id()
        t.integer('user_id')
        t.string('title')
      })
      const ada = await User.create({ name: 'Ada', age: 35 })
      await User.create({ name: 'Bob', age: 20 }) // no posts
      const cara = await User.create({ name: 'Cara', age: 40 })
      await Post.create({ user_id: ada.id, title: 'a1' })
      await Post.create({ user_id: ada.id, title: 'a2' })
      await Post.create({ user_id: cara.id, title: 'c1' })
    })

    test('whereRaw', async () => {
      expect(await User.query().whereRaw('age > ?', [30]).count()).toBe(2)
    })

    test('selectRaw', async () => {
      const rows = await new QueryBuilder(conn, 'users').selectRaw('COUNT(*) AS c').get()
      expect(Number(rows[0]?.c)).toBe(3)
    })

    test('raw() helper runs arbitrary SQL', async () => {
      const rows = await raw<{ c: number | string }>(
        'SELECT COUNT(*) AS c FROM users WHERE age > $1'.replace('$1', conn.grammar.placeholder(0)),
        [30],
      )
      expect(Number(rows[0]?.c)).toBe(2)
    })

    test('whereIn with a subquery', async () => {
      const withPosts = await User.query()
        .whereIn('id', Post.query().select('user_id').getQuery())
        .orderBy('id')
        .get()
      expect(withPosts.count()).toBe(2)
      expect(withPosts.pluck('name').all()).toEqual(['Ada', 'Cara'])
    })

    test('whereExists (correlated subquery)', async () => {
      const sub = new QueryBuilder(conn, 'posts').whereRaw('posts.user_id = users.id')
      const withPosts = await User.query().whereExists(sub).orderBy('id').get()
      expect(withPosts.count()).toBe(2)
    })
  })
}
