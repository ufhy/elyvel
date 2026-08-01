import type { User } from '@elyvel/auth'
import type { TestClient } from '@elyvel/testing'
import { join } from 'node:path'
import { stopActingAs } from '@elyvel/auth'
import { createApp } from '@elyvel/core'
import { migrate } from '@elyvel/database'
import { createTestClient, refreshDatabase } from '@elyvel/testing'
import { withoutVite } from '@elyvel/vite'
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Comment } from '../app/models/Comment'
import { Post } from '../app/models/Post'

const basePath = join(import.meta.dir, '..')

// Laravel's `withoutVite()`: these tests render Inertia pages without running
// `vite build` first, and the asset tags aren't what they assert on. Rendering
// throws otherwise — deliberately, because the old fallback shipped dev-server
// URLs to real visitors when no build existed.
withoutVite()

const savedAppKey = process.env.APP_KEY
process.env.APP_KEY = 'base64:test-key'
afterAll(() => {
  if (savedAppKey === undefined)
    delete process.env.APP_KEY
  else process.env.APP_KEY = savedAppKey
})
afterEach(() => stopActingAs())

const AUTHOR: User = { id: 'author-1', name: 'Ada Lovelace', email: 'ada@example.com', emailVerified: true }
const COMMENTER: User = { id: 'commenter-1', name: 'Grace Hopper', email: 'grace@example.com', emailVerified: true }
const OTHER: User = { id: 'other-1', name: 'Barbara Liskov', email: 'barbara@example.com', emailVerified: true }

describe('Comments (route-model-binding + CommentPolicy)', () => {
  let client: TestClient

  beforeEach(async () => {
    const app = await createApp({ basePath })
    await refreshDatabase({
      seed: async (connection) => { await migrate(connection, join(basePath, 'database/migrations')) },
    })
    client = createTestClient(app)
  })

  test('a signed-in user can comment on a post', async () => {
    const post = await Post.create({ title: 'P', slug: 'p', body: 'x', user_id: AUTHOR.id, author_name: AUTHOR.name, author_email: AUTHOR.email })
    await client.actingAs(COMMENTER)
    await client.get('/blog')

    const res = await client.post(`/blog/${post.id}/comments`, { json: { body: 'nice post!' } })
    res.assertStatus(201)
    expect(await Comment.query().where('post_id', post.id).count()).toBe(1)
  })

  test('the comment author can delete their own comment', async () => {
    const post = await Post.create({ title: 'P', slug: 'p', body: 'x', user_id: AUTHOR.id, author_name: AUTHOR.name, author_email: AUTHOR.email })
    const comment = await Comment.create({ post_id: post.id, user_id: COMMENTER.id, author_name: COMMENTER.name, body: 'mine' })

    await client.actingAs(COMMENTER)
    await client.get('/blog')
    const res = await client.delete(`/blog/${post.id}/comments/${comment.id}`)
    res.assertStatus(204)
    expect(await Comment.find(comment.id)).toBeUndefined()
  })

  test('CommentPolicy denies deleting someone else\'s comment (403, not deleted)', async () => {
    const post = await Post.create({ title: 'P', slug: 'p', body: 'x', user_id: AUTHOR.id, author_name: AUTHOR.name, author_email: AUTHOR.email })
    const comment = await Comment.create({ post_id: post.id, user_id: COMMENTER.id, author_name: COMMENTER.name, body: 'mine' })

    await client.actingAs(OTHER)
    await client.get('/blog')
    const res = await client.delete(`/blog/${post.id}/comments/${comment.id}`)
    res.assertStatus(403)
    expect(await Comment.find(comment.id)).not.toBeUndefined() // still there
  })

  test('deleting a nonexistent comment 404s via route-model-binding (not a manual check)', async () => {
    const post = await Post.create({ title: 'P', slug: 'p', body: 'x', user_id: AUTHOR.id, author_name: AUTHOR.name, author_email: AUTHOR.email })

    await client.actingAs(OTHER)
    await client.get('/blog')
    const res = await client.delete(`/blog/${post.id}/comments/999999`)
    res.assertStatus(404)
  })

  test('a comment cannot be deleted via a URL naming the WRONG parent post, even by its own author', async () => {
    const postA = await Post.create({ title: 'A', slug: 'a', body: 'x', user_id: AUTHOR.id, author_name: AUTHOR.name, author_email: AUTHOR.email })
    const postB = await Post.create({ title: 'B', slug: 'b', body: 'x', user_id: AUTHOR.id, author_name: AUTHOR.name, author_email: AUTHOR.email })
    const comment = await Comment.create({ post_id: postA.id, user_id: COMMENTER.id, author_name: COMMENTER.name, body: 'mine on A' })

    await client.actingAs(COMMENTER)
    await client.get('/blog')
    // The comment belongs to postA, but the URL names postB.
    const res = await client.delete(`/blog/${postB.id}/comments/${comment.id}`)
    res.assertStatus(404)
    expect(await Comment.find(comment.id)).not.toBeUndefined() // still there

    // Sanity check: the SAME comment, deleted via its real post, works.
    const ok = await client.delete(`/blog/${postA.id}/comments/${comment.id}`)
    ok.assertStatus(204)
    expect(await Comment.find(comment.id)).toBeUndefined()
  })
})
