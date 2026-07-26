import type { Concern } from '../src/concern'
import type { EloquentBuilder } from '../src/eloquent-builder'
import type { QueryBuilder } from '../src/query-builder'
import { beforeEach, describe, expect, test } from 'bun:test'
import { withConcerns } from '../src/concern'
import { createConnection, setConnection } from '../src/connection'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'

interface HasStatusFields {
  status: string
}

const HasStatus: Concern = {
  fillable: ['status'],
  casts: { status: 'string' },
  scopes: {
    active: (q: EloquentBuilder<any>) => q.where('status', 'active'),
  },
}

interface HasViewsFields {
  views: number
  incrementViews(): void
}

const HasViews: Concern = {
  casts: { views: 'int' },
  methods: {
    incrementViews(this: Model & HasViewsFields) {
      this.views = (this.views ?? 0) + 1
    },
  },
}

interface SoftPublishFields {
  published: boolean
}

const SoftPublish: Concern = {
  fillable: ['published'],
  casts: { published: 'boolean' },
  globalScopes: {
    published: (q: QueryBuilder) => q.where('published', true),
  },
}

// eslint-disable-next-line ts/no-unsafe-declaration-merging -- concerns only ADD plain data fields, never conflict with Model's own members
interface Post extends HasStatusFields, HasViewsFields {}
// eslint-disable-next-line ts/no-unsafe-declaration-merging
class Post extends Model {
  static override table = 'posts'
  static override timestamps = false
  static override fillable = ['title']
  declare id: number
  declare title: string
}
withConcerns(Post, HasStatus, HasViews)

// eslint-disable-next-line ts/no-unsafe-declaration-merging
interface Article extends SoftPublishFields {}
// eslint-disable-next-line ts/no-unsafe-declaration-merging
class Article extends Model {
  static override table = 'articles'
  static override timestamps = false
  static override fillable = ['title']
  declare id: number
  declare title: string
}
withConcerns(Article, SoftPublish)

describe('withConcerns', () => {
  beforeEach(async () => {
    const conn = await createConnection({ driver: 'sqlite', database: ':memory:' })
    setConnection(conn)
    const schema = new SchemaBuilder(conn)
    await schema.create('posts', (t) => {
      t.id()
      t.string('title')
      t.string('status').nullable()
      t.integer('views').default(0)
    })
    await schema.create('articles', (t) => {
      t.id()
      t.string('title')
      t.boolean('published').default(false)
    })
  })

  test('merges fillable/casts from multiple concerns without clobbering', async () => {
    const post = await Post.create({ title: 'A', status: 'active' })
    expect(post.status).toBe('active')
    expect(typeof post.views).toBe('number')
  })

  test('a local scope from a concern is opt-in via .scope()', async () => {
    await Post.create({ title: 'A', status: 'active' })
    await Post.create({ title: 'B', status: 'draft' })
    expect(await Post.query().scope('active').count()).toBe(1)
    // without .scope(), both rows are visible — proves it's opt-in, not global
    expect(await Post.query().count()).toBe(2)
  })

  test('a method from a concern is callable and persists via save()', async () => {
    const post = await Post.create({ title: 'A', status: 'active' })
    post.incrementViews()
    post.incrementViews()
    await post.save()
    const reloaded = await Post.find(post.id)
    expect(reloaded?.views).toBe(2)
  })

  test('a global scope from a concern applies automatically, with no .scope() call', async () => {
    await Article.create({ title: 'Published one', published: true })
    await Article.create({ title: 'Hidden draft', published: false })
    const visible = await Article.query().get()
    expect(visible.all().map(a => a.title)).toEqual(['Published one'])
  })

  test('two independently-defined concerns on different models don\'t leak into each other', () => {
    expect(Post.fillable).not.toContain('published')
    expect(Article.fillable).not.toContain('status')
  })
})
