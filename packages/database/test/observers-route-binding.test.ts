import { beforeEach, describe, expect, test } from 'bun:test'
import { createConnection, setConnection } from '../src/connection'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'

class Post extends Model {
  static override guarded = []
  static override table = 'posts'
  static override timestamps = false
  declare id: number
  declare slug: string
  declare title: string
}

class SoftPost extends Model {
  static override guarded = []
  static override table = 'soft_posts'
  static override timestamps = false
  static override softDeletes = true
  declare id: number
  declare slug: string
  declare title: string
}

beforeEach(async () => {
  const conn = await createConnection({ driver: 'sqlite', database: ':memory:' })
  setConnection(conn)
  await new SchemaBuilder(conn).create('posts', (t) => {
    t.id()
    t.string('slug')
    t.string('title')
  })
  await new SchemaBuilder(conn).create('soft_posts', (t) => {
    t.id()
    t.string('slug')
    t.string('title')
    t.timestamp('deleted_at').nullable()
  })
})

describe('Model.observe()', () => {
  test('an observer object wires each matching method to its event', async () => {
    const calls: string[] = []
    Post.observe({
      creating: () => void calls.push('creating'),
      created: post => void calls.push(`created:${(post as Post).title}`),
      updated: () => void calls.push('updated'),
    })

    const post = await Post.create({ slug: 'a', title: 'Hello' })
    expect(calls).toEqual(['creating', 'created:Hello'])

    post.title = 'Changed'
    await post.save()
    expect(calls).toContain('updated')
  })

  test('an observer class is instantiated and bound (methods keep `this`)', async () => {
    const seen: string[] = []
    class PostObserver {
      private readonly tag = 'obs'
      created(post: Post): void {
        seen.push(`${this.tag}:${post.slug}`)
      }
    }
    Post.observe(PostObserver)
    await Post.create({ slug: 'zed', title: 'Z' })
    expect(seen).toEqual(['obs:zed'])
  })
})

describe('route model binding', () => {
  test('resolveRouteBinding binds by primary key (routeKeyName) by default', async () => {
    const created = await Post.create({ slug: 'a', title: 'A' })
    const found = await Post.resolveRouteBinding(created.id)
    expect(found?.title).toBe('A')
    expect(await Post.resolveRouteBinding(9999)).toBeUndefined()
  })

  test('resolveRouteBinding binds by a custom field (e.g. slug)', async () => {
    await Post.create({ slug: 'hello-world', title: 'HW' })
    const found = await Post.resolveRouteBinding('hello-world', 'slug')
    expect(found?.title).toBe('HW')
  })

  test('routeKeyName override changes the default binding column', async () => {
    class Article extends Post {
      static override table = 'posts'
      static override routeKeyName = 'slug'
    }
    await Article.create({ slug: 'my-slug', title: 'MS' })
    const found = await Article.resolveRouteBinding('my-slug')
    expect(found?.title).toBe('MS')
  })
})

describe('findWithTrashed / resolveRouteBindingWithTrashed (resource({ withTrashed }) support)', () => {
  test('findWithTrashed resolves a soft-deleted row; find() does not', async () => {
    const post = await SoftPost.create({ slug: 'a', title: 'A' })
    await post.delete()

    expect(await SoftPost.find(post.id)).toBeUndefined()
    const found = await SoftPost.findWithTrashed(post.id)
    expect(found?.title).toBe('A')
    expect(found?.trashed()).toBe(true)
  })

  test('resolveRouteBindingWithTrashed resolves by a custom field even when trashed', async () => {
    const post = await SoftPost.create({ slug: 'gone', title: 'Gone' })
    await post.delete()

    expect(await SoftPost.resolveRouteBinding('gone', 'slug')).toBeUndefined()
    const found = await SoftPost.resolveRouteBindingWithTrashed('gone', 'slug')
    expect(found?.title).toBe('Gone')
  })

  test('a live (non-trashed) row resolves normally through either method', async () => {
    const post = await SoftPost.create({ slug: 'live', title: 'Live' })
    expect((await SoftPost.find(post.id))?.title).toBe('Live')
    expect((await SoftPost.findWithTrashed(post.id))?.title).toBe('Live')
  })
})
