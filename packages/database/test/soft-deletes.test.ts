import { beforeEach, describe, expect, test } from 'bun:test'
import { createConnection, setConnection } from '../src/connection'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'

class Article extends Model {
  static override table = 'articles'
  static override timestamps = false
  static override softDeletes = true
  declare id: number
  declare title: string
}

class Task extends Model {
  static override table = 'tasks'
  static override timestamps = false
  declare id: number
  declare done: number
}
// A named global scope applied to every Task query.
Task.addGlobalScope('pending', (qb) => qb.where('done', 0))

const dialects = [
  { name: 'sqlite', connect: () => createConnection({ driver: 'sqlite', database: ':memory:' }) },
  { name: 'pglite', connect: () => createConnection({ driver: 'pglite' }) },
] as const

for (const d of dialects) {
  describe(`soft deletes + global scopes (${d.name})`, () => {
    beforeEach(async () => {
      const conn = await d.connect()
      setConnection(conn)
      const schema = new SchemaBuilder(conn)
      await schema.create('articles', (t) => {
        t.id()
        t.string('title')
        t.softDeletes()
      })
      await schema.create('tasks', (t) => {
        t.id()
        t.integer('done')
      })
    })

    test('delete() soft-deletes and default queries exclude trashed', async () => {
      await Article.create({ title: 'A' })
      await Article.create({ title: 'B' })
      const c = await Article.create({ title: 'C' })

      await c.delete()
      expect(c.trashed()).toBe(true)
      expect(c.exists).toBe(true) // row still present

      expect(await Article.query().count()).toBe(2) // trashed excluded
      expect(await Article.find(c.id)).toBeUndefined()
    })

    test('withTrashed / onlyTrashed', async () => {
      const a = await Article.create({ title: 'A' })
      await Article.create({ title: 'B' })
      await a.delete()

      expect(await Article.query().withTrashed().count()).toBe(2)
      expect(await Article.query().onlyTrashed().count()).toBe(1)
    })

    test('restore brings a row back; forceDelete removes it', async () => {
      const a = await Article.create({ title: 'A' })
      await a.delete()
      await a.restore()
      expect(a.trashed()).toBe(false)
      expect(await Article.query().count()).toBe(1)

      await a.forceDelete()
      expect(await Article.query().withTrashed().count()).toBe(0)
    })

    test('global scope filters by default and can be bypassed', async () => {
      await Task.create({ done: 0 })
      await Task.create({ done: 0 })
      await Task.create({ done: 1 })

      expect(await Task.query().count()).toBe(2) // scope: only pending
      expect(await Task.query().withoutGlobalScope('pending').count()).toBe(3)
    })
  })
}
