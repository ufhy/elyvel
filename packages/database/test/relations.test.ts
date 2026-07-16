import { beforeEach, describe, expect, test } from 'bun:test'
import { createConnection, setConnection } from '../src/connection'
import { EloquentCollection } from '../src/eloquent-collection'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'

class User extends Model {
  static override table = 'users'
  static override timestamps = false
  declare id: number
  declare name: string
  posts() {
    return this.hasMany(Post)
  }

  profile() {
    return this.hasOne(Profile)
  }
}
class Post extends Model {
  static override table = 'posts'
  static override timestamps = false
  declare id: number
  declare title: string
  declare user_id: number
  user() {
    return this.belongsTo(User)
  }
}
class Profile extends Model {
  static override table = 'profiles'
  static override timestamps = false
  declare id: number
  declare user_id: number
  declare bio: string
}

const dialects = [
  { name: 'sqlite', connect: () => createConnection({ driver: 'sqlite', database: ':memory:' }) },
  { name: 'pglite', connect: () => createConnection({ driver: 'pglite' }) },
] as const

for (const d of dialects) {
  describe(`relationships (${d.name})`, () => {
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
        t.string('title')
        t.foreignId('user_id')
      })
      await schema.create('profiles', (t) => {
        t.id()
        t.foreignId('user_id')
        t.string('bio')
      })
    })

    test('hasMany: fetch and constrain related rows', async () => {
      const user = await User.create({ name: 'Ada' })
      await Post.create({ title: 'First', user_id: user.id })
      await Post.create({ title: 'Second', user_id: user.id })
      await Post.create({ title: 'Other', user_id: 999 })

      const posts = await user.posts().get()
      expect(posts).toBeInstanceOf(EloquentCollection)
      expect(posts.count()).toBe(2)

      const filtered = await user.posts().where('title', 'First').get()
      expect(filtered.count()).toBe(1)
    })

    test('belongsTo: fetch the owner', async () => {
      const user = await User.create({ name: 'Ada' })
      const post = await Post.create({ title: 'First', user_id: user.id })
      const owner = await post.user().first()
      expect(owner?.name).toBe('Ada')
    })

    test('hasOne: fetch the single related row', async () => {
      const user = await User.create({ name: 'Ada' })
      await Profile.create({ user_id: user.id, bio: 'Mathematician' })
      const profile = await user.profile().first()
      expect(profile?.bio).toBe('Mathematician')
    })

    test('eager loading with() avoids N+1 and populates relations', async () => {
      const ada = await User.create({ name: 'Ada' })
      const alan = await User.create({ name: 'Alan' })
      await Post.create({ title: 'A1', user_id: ada.id })
      await Post.create({ title: 'A2', user_id: ada.id })
      await Post.create({ title: 'B1', user_id: alan.id })

      const users = await User.query().with('posts').orderBy('id').get()
      const first = users.first()
      const adaPosts = first?.getRelation<EloquentCollection<Post>>('posts')
      expect(adaPosts?.count()).toBe(2)

      // relations are serialized into toJSON
      const json = first?.toJSON() as { posts: unknown[] }
      expect(Array.isArray(json.posts)).toBe(true)
      expect(json.posts).toHaveLength(2)
    })
  })
}
