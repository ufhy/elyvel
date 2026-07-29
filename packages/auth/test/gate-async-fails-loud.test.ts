import { describe, expect, test } from 'bun:test'
import { Gate } from '../src/gate'

class Post {
  constructor(public id: number, public authorId: number) {}
}

/**
 * Regression: `toResponse()` did `value ? allow() : deny()`. A Promise is
 * truthy, so an `async` policy method or ability resolved to ALLOW for every
 * user and every ability — the route it guarded was fully open. `async` is the
 * natural form to reach for the moment a check touches the database, and the
 * loose `policy(model, object)` signature meant TypeScript never complained.
 *
 * The Gate API is synchronous by contract, so the fix is to fail LOUD.
 */
describe('an async ability or policy method is rejected, never silently allowed', () => {
  test('async policy method throws instead of allowing the wrong user', () => {
    const gate = new Gate()
    gate.policy(Post, {
      async update(user: any, post: Post) {
        return user.id === post.authorId
      },
    } as any)

    expect(() => gate.allows('update', { id: 999 } as any, new Post(1, 1))).toThrow(/returned a Promise/)
    // …and not even for the *right* user: the check never ran at all.
    expect(() => gate.allows('update', { id: 1 } as any, new Post(1, 1))).toThrow(/returned a Promise/)
  })

  test('async named ability throws', () => {
    const gate = new Gate()
    gate.define('admin', (() => Promise.resolve(false)) as any)
    expect(() => gate.allows('admin', { id: 1 } as any)).toThrow(/returned a Promise/)
  })

  test('async policy.before throws', () => {
    const gate = new Gate()
    gate.policy(Post, {
      before: (() => Promise.resolve(true)) as any,
      update: () => false,
    } as any)
    expect(() => gate.allows('update', { id: 1 } as any, new Post(1, 1))).toThrow(/returned a Promise/)
  })

  test('async Gate.before hook throws', () => {
    const gate = new Gate()
    gate.before((() => Promise.resolve(true)) as any)
    gate.define('x', () => false)
    expect(() => gate.allows('x', { id: 1 } as any)).toThrow(/returned a Promise/)
  })

  test('synchronous policies and abilities are unaffected', () => {
    const gate = new Gate()
    gate.policy(Post, { update: (user: any, post: Post) => user.id === post.authorId })
    expect(gate.allows('update', { id: 1 } as any, new Post(1, 1))).toBe(true)
    expect(gate.allows('update', { id: 9 } as any, new Post(1, 1))).toBe(false)

    const named = new Gate()
    named.define('admin', (user: any) => user?.role === 'admin')
    expect(named.allows('admin', { role: 'admin' } as any)).toBe(true)
    expect(named.allows('admin', { role: 'user' } as any)).toBe(false)
  })
})
