import type { User } from '@elyvel/auth'
import type { TestClient } from '@elyvel/testing'
import { join } from 'node:path'
import { actingAs, gate, stopActingAs } from '@elyvel/auth'
import { createApp } from '@elyvel/core'
import { migrate } from '@elyvel/database'
import { createTestClient, refreshDatabase } from '@elyvel/testing'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { Post } from '../app/models/Post'

const basePath = join(import.meta.dir, '..')

// createApp() reads APP_KEY from the environment (session cookie secret) —
// set a test-only value so this file doesn't depend on a local .env.
const savedAppKey = process.env.APP_KEY
process.env.APP_KEY = 'base64:test-key'
afterAll(() => {
  if (savedAppKey === undefined)
    delete process.env.APP_KEY
  else process.env.APP_KEY = savedAppKey
})

const AUTHOR: User = { id: 'author-1', name: 'Ada Lovelace', email: 'ada@example.com', emailVerified: true }
const OTHER: User = { id: 'other-1', name: 'Grace Hopper', email: 'grace@example.com', emailVerified: true }

describe('Blog', () => {
  let client: TestClient

  beforeEach(async () => {
    const app = await createApp({ basePath })
    await refreshDatabase({
      seed: async (connection) => { await migrate(connection, join(basePath, 'database/migrations')) },
    })
    client = createTestClient(app)
  })

  test('the index only lists published posts', async () => {
    const live = await Post.create({ title: 'Live post', slug: 'live-post', body: 'x', user_id: AUTHOR.id, author_name: AUTHOR.name, author_email: AUTHOR.email })
    live.published = true
    await live.save()
    // Left unpublished (default) — should never appear in the index.
    await Post.create({ title: 'Draft', slug: 'draft', body: 'x', user_id: AUTHOR.id, author_name: AUTHOR.name, author_email: AUTHOR.email })

    const res = await client.get('/blog', { headers: { 'x-inertia': 'true' } })
    res.assertOk()
    const titles = (res.json() as { props: { posts: { data: { title: string }[] } } }).props.posts.data.map(p => p.title)
    expect(titles).toEqual(['Live post'])
  })

  test('show 404s an unpublished post for guests, but 200s for its author', async () => {
    const post = await Post.create({ title: 'Scheduled', slug: 'scheduled', body: 'x', user_id: AUTHOR.id, author_name: AUTHOR.name, author_email: AUTHOR.email })

    stopActingAs()
    const asGuest = await client.get(`/blog/${post.id}`, { headers: { accept: 'application/json' } })
    asGuest.assertStatus(404)

    actingAs(AUTHOR)
    const asAuthor = await client.get(`/blog/${post.id}`)
    asAuthor.assertOk()
    stopActingAs()
  })

  test('PostPolicy only lets the author update or delete their post', async () => {
    const post = await Post.create({ title: 'Mine', slug: 'mine', body: 'x', user_id: AUTHOR.id, author_name: AUTHOR.name, author_email: AUTHOR.email })

    expect(gate().forUser(AUTHOR).allows('update', post)).toBe(true)
    expect(gate().forUser(OTHER).allows('update', post)).toBe(false)
    expect(gate().forUser(OTHER).allows('delete', post)).toBe(false)
  })

  test('a signed-in author can create a post (full CSRF round trip)', async () => {
    await client.actingAs(AUTHOR)

    // The cookie jar + XSRF header are automatic — one visit establishes the
    // session, and the client mirrors XSRF-TOKEN onto every mutating request.
    await client.get('/blog')
    const res = await client.post('/blog', { json: { title: 'New post', slug: 'new-post', body: 'Hello blog.' } })

    res.assertStatus(303)
    const created = await Post.query().where('slug', 'new-post').first()
    expect(created?.author_name).toBe(AUTHOR.name)
    stopActingAs()
  })
})
