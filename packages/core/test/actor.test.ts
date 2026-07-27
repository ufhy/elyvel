import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { beginActorScope, currentActorId, runWithActor, setCurrentActor } from '../src/actor'
import { requestContext } from '../src/request-context'

describe('actor (AsyncLocalStorage)', () => {
  test('currentActorId() is undefined outside any scope', () => {
    expect(currentActorId()).toBeUndefined()
  })

  test('setCurrentActor before any beginActorScope is a safe no-op (no store to mutate)', () => {
    // Must run before any other test in this file calls beginActorScope() —
    // ALS's enterWith() persists for the rest of THIS async continuation, so
    // a scope opened by an earlier test would otherwise leak into this one.
    setCurrentActor('ignored')
    expect(currentActorId()).toBeUndefined()
  })

  test('beginActorScope + setCurrentActor makes the id visible for the rest of the scope', () => {
    beginActorScope()
    expect(currentActorId()).toBeUndefined()
    setCurrentActor('user-1')
    expect(currentActorId()).toBe('user-1')
  })

  test('runWithActor sets the id for its callback, restored outside', () => {
    const before = currentActorId()
    const inside = runWithActor('system', () => currentActorId())
    expect(inside).toBe('system')
    expect(currentActorId()).toBe(before) // back to whatever was ambient before the call
  })

  // The exact shape of the real bug this design works around: a value entered
  // via `enterWith()` AFTER an internal `await` inside an async `.derive()`
  // does not propagate to Elysia's subsequent handler call on Bun — mutating a
  // box entered earlier (in a synchronous `onRequest`, before any await) does.
  test('an async derive can fill in the actor id AFTER an internal await, and the handler sees it', async () => {
    const app = new Elysia()
      .use(requestContext())
      .derive({ as: 'global' }, async () => {
        await new Promise(r => setTimeout(r, 1)) // simulates an async session lookup
        setCurrentActor('resolved-user')
        return {}
      })
      .get('/whoami', () => ({ actor: currentActorId() }))

    const res = await app.handle(new Request('http://localhost/whoami'))
    expect(await res.json()).toEqual({ actor: 'resolved-user' })
  })

  test('concurrent requests never see each other\'s actor id', async () => {
    const app = new Elysia()
      .use(requestContext())
      .derive({ as: 'global' }, async ({ query }: any) => {
        await new Promise(r => setTimeout(r, Math.random() * 10))
        setCurrentActor(query.user)
        return {}
      })
      .get('/whoami', async () => {
        await new Promise(r => setTimeout(r, Math.random() * 10))
        return { actor: currentActorId() }
      })

    const results = await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map(async (user) => {
        const res = await app.handle(new Request(`http://localhost/whoami?user=${user}`))
        return (await res.json()) as { actor: string }
      }),
    )
    expect(results.map(r => r.actor)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})
