import type { Connection } from '../src/connection'
import { beforeEach, describe, expect, test } from 'bun:test'
import { createConnection, setConnection } from '../src/connection'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'

class Tag extends Model {
  static override table = 'tags'
  static override guarded = []
  static override timestamps = false
}
class Post extends Model {
  static override table = 'posts'
  static override guarded = []
  static override timestamps = false
  tags(): ReturnType<Post['belongsToMany']> {
    return this.belongsToMany(Tag, 'post_tag', 'post_id', 'tag_id')
  }
}

let connection: Connection
let php: Tag
let js: Tag

// `test/setup.ts` is preloaded and closes every connection after EACH test, so
// the fixture is built per test rather than once in beforeAll.
beforeEach(async () => {
  connection = await createConnection({ driver: 'sqlite', database: ':memory:' })
  setConnection(connection)
  const schema = new SchemaBuilder(connection)
  await schema.create('tags', (t) => {
    t.id()
    t.string('name')
  })
  await schema.create('posts', (t) => {
    t.id()
    t.string('title')
  })
  await schema.create('post_tag', (t) => {
    t.integer('post_id')
    t.integer('tag_id')
  })

  php = await Tag.create({ name: 'php' })
  js = await Tag.create({ name: 'js' })
  const a = await Post.create({ title: 'A' })
  const b = await Post.create({ title: 'B' })
  const c = await Post.create({ title: 'C' })
  await a.tags().attach([php.getKey()])
  await b.tags().attach([js.getKey()])
  await c.tags().attach([php.getKey(), js.getKey()])
})

async function titles(query: ReturnType<typeof Post.query>): Promise<string[]> {
  return (await query.get())
    .all()
    .map(post => post.getAttribute('title') as string)
    .sort()
}

/** `whereAttachedTo` — constrain a belongsToMany relation to specific related models. */
describe('whereAttachedTo', () => {
  test('a single related model', async () => {
    expect(await titles(Post.query().whereAttachedTo('tags', php))).toEqual(['A', 'C'])
    expect(await titles(Post.query().whereAttachedTo('tags', js))).toEqual(['B', 'C'])
  })

  test('an array of related models matches any of them', async () => {
    expect(await titles(Post.query().whereAttachedTo('tags', [php, js]))).toEqual(['A', 'B', 'C'])
  })

  test('a collection of related models', async () => {
    const all = await Tag.query().get()
    expect(await titles(Post.query().whereAttachedTo('tags', all))).toEqual(['A', 'B', 'C'])
  })

  test('whereNotAttachedTo is the negation', async () => {
    expect(await titles(Post.query().whereNotAttachedTo('tags', php))).toEqual(['B'])
    expect(await titles(Post.query().whereNotAttachedTo('tags', js))).toEqual(['A'])
  })

  test('attached to nothing matches nothing; not-attached to nothing matches everything', async () => {
    expect(await titles(Post.query().whereAttachedTo('tags', []))).toEqual([])
    expect(await titles(Post.query().whereNotAttachedTo('tags', []))).toEqual(['A', 'B', 'C'])
  })

  test('it composes with other constraints', async () => {
    const found = await titles(Post.query().whereAttachedTo('tags', php).where('title', 'C'))
    expect(found).toEqual(['C'])
  })
})
