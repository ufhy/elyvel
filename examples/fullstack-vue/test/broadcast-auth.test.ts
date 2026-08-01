import type { User } from '@elyvel/auth'
import { join } from 'node:path'
import { actingAs, actingAsGuest, stopActingAs } from '@elyvel/auth'
import { broadcast } from '@elyvel/broadcasting'
import { createApp } from '@elyvel/core'
import { migrate } from '@elyvel/database'
import { refreshDatabase } from '@elyvel/testing'
import { withoutVite } from '@elyvel/vite'
import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { CommentBroadcast } from '../app/broadcasts/CommentBroadcast'
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

const AUTHOR: User = { id: 'author-1', name: 'Ada Lovelace', email: 'ada@example.com', emailVerified: true }
const OTHER: User = { id: 'other-1', name: 'Grace Hopper', email: 'grace@example.com', emailVerified: true }

afterEach(() => stopActingAs())

let port = 19200
function nextPort(): number {
  return port++
}

/** Boot the app (once per test — this app also becomes the process's active broadcast hub) and start it listening on a real port. */
async function bootAndListen(): Promise<number> {
  const app = await createApp({ basePath })
  await refreshDatabase({
    seed: async (connection) => { await migrate(connection, join(basePath, 'database/migrations')) },
  })
  const p = nextPort()
  await app.listen(p)
  return p
}

/** Connect a real WebSocket, subscribe to `channel`, and resolve with the first frame received for it. */
async function subscribeAndAwait(wsPort: number, channel: string, timeoutMs = 500): Promise<{ event?: string } | 'timeout'> {
  const ws = new WebSocket(`ws://localhost:${wsPort}`)
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = e => reject(new Error(`ws failed to open: ${JSON.stringify(e)}`))
  })
  ws.send(JSON.stringify({ event: 'subscribe', channel }))
  const result = await new Promise<{ event?: string } | 'timeout'>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs, 'timeout')
    ws.onmessage = (raw) => {
      const msg = JSON.parse(String(raw.data)) as { channel?: string, event?: string }
      if (msg.channel === channel) {
        clearTimeout(timer)
        resolve(msg)
      }
    }
  })
  ws.close()
  return result
}

describe('private-posts.{id} channel authorization (real WebSocket)', () => {
  test('a guest CAN subscribe to a published post\'s comment channel', async () => {
    const p = await bootAndListen()
    const post = await Post.create({ title: 'Live', slug: 'live', body: 'x', user_id: AUTHOR.id, author_name: AUTHOR.name, author_email: AUTHOR.email })
    post.published = true
    await post.save()

    actingAsGuest()
    const subscription = subscribeAndAwait(p, `private-posts.${post.id}`)
    await new Promise(resolve => setTimeout(resolve, 30)) // let the subscribe land
    const comment = await Comment.create({ body: 'hi', post_id: post.id, user_id: OTHER.id, author_name: OTHER.name })
    await broadcast(new CommentBroadcast(comment, post))

    expect(await subscription).toMatchObject({ event: 'CommentBroadcast' })
  })

  test('a guest CANNOT subscribe to an unpublished post\'s comment channel', async () => {
    const p = await bootAndListen()
    const post = await Post.create({ title: 'Draft', slug: 'draft', body: 'x', user_id: AUTHOR.id, author_name: AUTHOR.name, author_email: AUTHOR.email })
    // left unpublished (default)

    actingAsGuest()
    const result = await subscribeAndAwait(p, `private-posts.${post.id}`)
    expect(result).toMatchObject({ event: 'subscription_error' })
  })

  test('a non-author signed-in user also cannot subscribe to an unpublished post', async () => {
    const p = await bootAndListen()
    const post = await Post.create({ title: 'Draft2', slug: 'draft-2', body: 'x', user_id: AUTHOR.id, author_name: AUTHOR.name, author_email: AUTHOR.email })

    actingAs(OTHER)
    const result = await subscribeAndAwait(p, `private-posts.${post.id}`)
    expect(result).toMatchObject({ event: 'subscription_error' })
  })

  test('the post\'s own author CAN subscribe to their unpublished post', async () => {
    const p = await bootAndListen()
    const post = await Post.create({ title: 'Draft3', slug: 'draft-3', body: 'x', user_id: AUTHOR.id, author_name: AUTHOR.name, author_email: AUTHOR.email })

    actingAs(AUTHOR)
    const subscription = subscribeAndAwait(p, `private-posts.${post.id}`)
    await new Promise(resolve => setTimeout(resolve, 30))
    const comment = await Comment.create({ body: 'own post', post_id: post.id, user_id: AUTHOR.id, author_name: AUTHOR.name })
    await broadcast(new CommentBroadcast(comment, post))

    expect(await subscription).toMatchObject({ event: 'CommentBroadcast' })
  })
})
