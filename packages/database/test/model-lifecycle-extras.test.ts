import { beforeEach, describe, expect, test } from 'bun:test'
import { setConnection } from '../src/connection'
import { EloquentCollection } from '../src/eloquent-collection'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'
import { dialects } from './dialects'

class Post extends Model {
  static override guarded = []
  static override table = 'posts'
  static override timestamps = false
  static override touches = ['author']
  declare id: number
  declare title: string
  declare author_id: number
  author() {
    return this.belongsTo(Author, 'author_id')
  }
}

class Author extends Model {
  static override guarded = []
  static override table = 'authors'
  static override timestamps = true
  declare id: number
  declare name: string
  declare updated_at: string
}

class SoftPost extends Model {
  static override guarded = []
  static override table = 'soft_posts'
  static override timestamps = false
  static override softDeletes = true
  declare id: number
  declare title: string
}

class Person extends Model {
  static override guarded = []
  static override table = 'people'
  static override timestamps = false
  static override accessors = {
    full_name: {
      get: (m: Model) => `${m.getAttribute('first_name')} ${m.getAttribute('last_name')}`,
      set: (v: unknown) => {
        const [first, last] = String(v).split(' ')
        return { first_name: first, last_name: last }
      },
    },
  }

  declare id: number
  declare first_name: string
  declare last_name: string
  declare full_name: string
}

class PersonCollection<M extends Model> extends EloquentCollection<M> {
  names(): string[] {
    return this.all().map(m => String(m.getAttribute('first_name')))
  }
}

class NamedPerson extends Model {
  static override guarded = []
  static override table = 'people'
  static override timestamps = false
  static override newCollection<M extends Model>(models: M[]): EloquentCollection<M> {
    return new PersonCollection<M>(models)
  }

  declare id: number
  declare first_name: string
}

for (const d of dialects) {
  describe(`model lifecycle extras (${d.name})`, () => {
    beforeEach(async () => {
      const conn = await d.connect()
      setConnection(conn)
      const schema = new SchemaBuilder(conn)
      await schema.create('authors', (t) => {
        t.id()
        t.string('name')
        t.timestamp('updated_at').nullable()
        t.timestamp('created_at').nullable()
      })
      await schema.create('posts', (t) => {
        t.id()
        t.string('title')
        t.integer('author_id')
      })
      await schema.create('people', (t) => {
        t.id()
        t.string('first_name')
        t.string('last_name').nullable()
      })
      await schema.create('soft_posts', (t) => {
        t.id()
        t.string('title')
        t.timestamp('deleted_at').nullable()
      })
    })

    test('wasRecentlyCreated is true right after create(), false for a hydrated/found row', async () => {
      const created = await Post.create({ title: 'A', author_id: 1 })
      expect(created.wasRecentlyCreated).toBe(true)

      const found = await Post.find(created.id)
      expect(found?.wasRecentlyCreated).toBe(false)

      // updateOrCreate on an EXISTING row must not flip it to true
      const updated = await Post.updateOrCreate({ id: created.id }, { title: 'A2' })
      expect(updated.wasRecentlyCreated).toBe(false)

      // updateOrCreate that actually inserts DOES flip it
      const inserted = await Post.updateOrCreate({ title: 'brand new' }, { author_id: 2 })
      expect(inserted.wasRecentlyCreated).toBe(true)
    })

    test('static touches bumps the related model\'s updated_at on save and on delete', async () => {
      const author = await Author.create({ name: 'Ada' })
      const originalUpdatedAt = author.updated_at

      await new Promise(r => setTimeout(r, 5))
      const post = await Post.create({ title: 'A', author_id: author.id })
      const afterCreate = await Author.find(author.id)
      expect(afterCreate?.updated_at).not.toBe(originalUpdatedAt)

      await new Promise(r => setTimeout(r, 5))
      await post.update({ title: 'A2' })
      const afterUpdate = await Author.find(author.id)
      expect(afterUpdate?.updated_at).not.toBe(afterCreate?.updated_at)

      await new Promise(r => setTimeout(r, 5))
      await post.delete()
      const afterDelete = await Author.find(author.id)
      expect(afterDelete?.updated_at).not.toBe(afterUpdate?.updated_at)
    })

    test('withoutTrashed() reverts an earlier withTrashed()/onlyTrashed() in the same chain', async () => {
      const p1 = await SoftPost.create({ title: 'kept' })
      const p2 = await SoftPost.create({ title: 'trashed' })
      await p2.delete()

      expect(await SoftPost.query().withTrashed().withoutTrashed().count()).toBe(1)
      expect((await SoftPost.query().withTrashed().withoutTrashed().first())?.getAttribute('title')).toBe(p1.title)
    })

    test('accessor set() fans a single computed field out into two real columns', async () => {
      const person = new Person()
      person.full_name = 'Ada Lovelace'
      expect(person.first_name).toBe('Ada')
      expect(person.last_name).toBe('Lovelace')
      expect(person.full_name).toBe('Ada Lovelace') // get() reads it back from first/last

      await person.save()
      const reloaded = await Person.find(person.id)
      expect(reloaded?.first_name).toBe('Ada')
      expect(reloaded?.full_name).toBe('Ada Lovelace')
    })

    test('newCollection() returns the model\'s custom EloquentCollection subclass', async () => {
      await NamedPerson.create({ first_name: 'Ada' })
      await NamedPerson.create({ first_name: 'Bob' })

      const all = await NamedPerson.query().orderBy('id').get()
      expect(all).toBeInstanceOf(PersonCollection)
      expect((all as PersonCollection<NamedPerson>).names()).toEqual(['Ada', 'Bob'])

      const created = await NamedPerson.createMany([{ first_name: 'Cy' }])
      expect(created).toBeInstanceOf(PersonCollection)
    })
  })
}
