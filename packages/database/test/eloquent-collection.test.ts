import { beforeEach, describe, expect, test } from 'bun:test'
import { setConnection } from '../src/connection'
import { EloquentCollection } from '../src/eloquent-collection'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'
import { dialects } from './dialects'

class Post extends Model {
  static override table = 'posts'
  static override timestamps = false
  static override fillable = ['title']
  declare id: number
  declare title: string
}

for (const d of dialects) {
  describe(`EloquentCollection (${d.name})`, () => {
    beforeEach(async () => {
      const conn = await d.connect()
      setConnection(conn)
      await new SchemaBuilder(conn).create('posts', (t) => {
        t.id()
        t.string('title')
      })
      await Post.create({ title: 'One' })
      await Post.create({ title: 'Two' })
      await Post.create({ title: 'Three' })
    })

    // The bug this guards against: diff/intersect/unique inherited from the
    // base Collection compare by object reference, so two freshly queried
    // collections of the SAME rows (distinct object instances) never match —
    // diff() would wrongly keep everything, intersect() would wrongly drop
    // everything.
    test('diff compares by primary key, not object reference', async () => {
      const all = await Post.all()
      const subset = await Post.query().whereIn('id', all.modelKeys().slice(0, 2)).get()

      const remaining = all.diff(subset)
      expect(remaining.count()).toBe(1)
      expect(remaining.modelKeys()).toEqual([all.modelKeys()[2]])
    })

    test('intersect compares by primary key, not object reference', async () => {
      const all = await Post.all()
      const subset = await Post.query().whereIn('id', all.modelKeys().slice(0, 2)).get()

      const shared = all.intersect(subset)
      expect(shared.modelKeys().sort()).toEqual(all.modelKeys().slice(0, 2).sort())
    })

    test('unique dedupes by primary key by default', async () => {
      const all = await Post.all()
      // Two independently-queried sets of the SAME rows — distinct object
      // instances, same primary keys — is exactly the case reference-equality
      // dedup gets wrong.
      const doubled = new EloquentCollection([...all.all(), ...(await Post.all()).all()])
      const deduped = doubled.unique()
      expect(deduped.count()).toBe(3)
    })

    test('unique still accepts a custom selector', async () => {
      const all = await Post.all()
      const deduped = all.unique(p => p.title.length)
      // 'One' (3), 'Two' (3), 'Three' (5) — first with a given length wins.
      expect(deduped.count()).toBe(2)
    })

    test('diff/intersect/unique results stay EloquentCollection (model-aware methods still work)', async () => {
      const all = await Post.all()
      const result = all.diff([])
      expect(result.find(all.modelKeys()[0])).toBeDefined()
    })

    test('findOrFail returns a contained model or throws', async () => {
      const all = await Post.all()
      const id = all.modelKeys()[0]
      expect(all.findOrFail(id).getKey()).toBe(id)
      expect(() => all.findOrFail(-1)).toThrow(/No model found in collection/)
    })

    test('contains matches by model, by key, or by predicate', async () => {
      const all = await Post.all()
      const post = all.first()!
      expect(all.contains(post)).toBe(true)
      expect(all.contains(post.getKey())).toBe(true)
      expect(all.contains(-1)).toBe(false)
      expect(all.contains(p => p.title === 'Two')).toBe(true)
    })

    test('only/except filter by primary key', async () => {
      const all = await Post.all()
      const [a, b, c] = all.modelKeys()
      expect(all.only(a, b).modelKeys().sort()).toEqual([a, b].sort())
      expect(all.except(a, b).modelKeys()).toEqual([c])
    })

    test('fresh re-fetches from the database', async () => {
      const all = await Post.all()
      await Post.query().where('id', all.modelKeys()[0] as number).update({ title: 'Updated' })
      const refreshed = await all.fresh()
      expect(refreshed.find(all.modelKeys()[0])?.title).toBe('Updated')
    })

    test('toQuery scopes a builder to this collection\'s models', async () => {
      const subset = await Post.query().limit(2).get()
      await subset.toQuery().update({ title: 'Bulk' })
      const untouched = await Post.query().whereNotIn('id', subset.modelKeys()).get()
      expect(untouched.all().every(p => p.title !== 'Bulk')).toBe(true)
      const updated = await Post.query().whereIn('id', subset.modelKeys()).get()
      expect(updated.all().every(p => p.title === 'Bulk')).toBe(true)
    })

    test('toQuery throws on an empty collection', () => {
      const empty = new EloquentCollection<Post>([])
      expect(() => empty.toQuery()).toThrow(/needs at least one model/)
    })

    test('makeVisible/makeHidden apply to every model in the collection', async () => {
      const all = await Post.all()
      all.makeHidden('title')
      expect(all.first()!.toObject().title).toBeUndefined()
      all.makeVisible('title')
      expect(all.first()!.toObject().title).toBe('One')
    })
  })
}
