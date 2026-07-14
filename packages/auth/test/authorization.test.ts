import { describe, expect, test } from 'bun:test'
import { AuthorizationError, Response, createGate, gate, setDefaultGate } from '../src/gate'

interface User {
  id: number
  role: 'admin' | 'member'
}

class Post {
  constructor(
    public id: number,
    public authorId: number,
  ) {}
}

class PostPolicy {
  view(_user: User | null): boolean {
    return true
  }
  create(user: User | null): boolean {
    return user?.role === 'member' || user?.role === 'admin'
  }
  update(user: User | null, post: Post): boolean | Response {
    return user?.id === post.authorId
      ? Response.allow()
      : Response.deny('You do not own this post.')
  }
  delete(user: User | null, post: Post): Response {
    return user?.id === post.authorId ? Response.allow() : Response.denyAsNotFound()
  }
}

const admin: User = { id: 99, role: 'admin' }
const alice: User = { id: 1, role: 'member' }
const bob: User = { id: 2, role: 'member' }
const post = new Post(10, alice.id)

// ── policies ──────────────────────────────────────────────────────────────
describe('policies', () => {
  const g = createGate<User>().policy(Post, new PostPolicy())

  test('routes model instance to the matching policy method', () => {
    expect(g.allows('update', alice, post)).toBe(true)
    expect(g.allows('update', bob, post)).toBe(false)
  })

  test('routes a class (no instance) to create-style methods', () => {
    expect(g.allows('create', alice, Post)).toBe(true)
    expect(g.allows('create', null, Post)).toBe(false) // guest denied
  })

  test('unknown policy method denies', () => {
    expect(g.allows('archive', alice, post)).toBe(false)
  })
})

// ── responses ───────────────────────────────────────────────────────────────
describe('responses', () => {
  const g = createGate<User>().policy(Post, new PostPolicy())

  test('inspect exposes message + status', () => {
    const denied = g.inspect('update', bob, post)
    expect(denied.denied()).toBe(true)
    expect(denied.message()).toBe('You do not own this post.')
    expect(denied.status()).toBe(403)

    expect(g.inspect('update', alice, post).allowed()).toBe(true)
  })

  test('denyAsNotFound carries a 404', () => {
    expect(g.inspect('delete', bob, post).status()).toBe(404)
  })

  test('authorize throws AuthorizationError with the response status', () => {
    try {
      g.authorize('delete', bob, post)
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(AuthorizationError)
      expect((e as AuthorizationError).status).toBe(404)
    }
    expect(() => g.authorize('update', alice, post)).not.toThrow()
  })
})

// ── before / after hooks ──────────────────────────────────────────────────
describe('before / after hooks', () => {
  test('before short-circuits (admin can do anything)', () => {
    const g = createGate<User>()
      .policy(Post, new PostPolicy())
      .before((user) => (user?.role === 'admin' ? true : null))
    expect(g.allows('update', admin, post)).toBe(true) // not the author, but admin
    expect(g.allows('update', bob, post)).toBe(false) // before returns null → falls through
  })

  test('after only fills in when the ability returned null (unknown ability)', () => {
    const g = createGate<User>().after((user) => user?.role === 'admin')
    expect(g.allows('anything', admin)).toBe(true)
    expect(g.allows('anything', bob)).toBe(false)
  })
})

// ── guests ──────────────────────────────────────────────────────────────────
describe('guests', () => {
  test('null user denied by default, opt-in with allowGuest', () => {
    const g = createGate<User>()
      .define('public-thing', () => true, { allowGuest: true })
      .define('member-thing', () => true)
    expect(g.allows('public-thing', null)).toBe(true)
    expect(g.allows('member-thing', null)).toBe(false)
  })
})

// ── any / none ────────────────────────────────────────────────────────────
describe('any / none', () => {
  const g = createGate<User>().policy(Post, new PostPolicy())
  test('any passes if one ability passes; none is its inverse', () => {
    expect(g.any(['update', 'view'], bob, post)).toBe(true) // view passes
    expect(g.none(['update', 'delete'], bob, post)).toBe(true) // both fail
  })
})

// ── forUser ───────────────────────────────────────────────────────────────
describe('forUser (per-request surface)', () => {
  const g = createGate<User>().policy(Post, new PostPolicy())
  test('binds the user and drops the arg', () => {
    const asAlice = g.forUser(alice)
    expect(asAlice.can('update', post)).toBe(true)
    expect(asAlice.cannot('update', new Post(11, bob.id))).toBe(true)
    expect(() => asAlice.authorize('update', post)).not.toThrow()
  })
})

// ── inline authorization ──────────────────────────────────────────────────
describe('inline authorization', () => {
  const g = createGate<User>()
  test('allowIf throws for guests / failing condition', () => {
    expect(() => g.allowIf((u) => u?.role === 'admin', admin)).not.toThrow()
    expect(() => g.allowIf((u) => u?.role === 'admin', bob)).toThrow(AuthorizationError)
    expect(() => g.allowIf(true, null)).toThrow(AuthorizationError) // guest always denied
  })
  test('denyIf throws when the condition holds', () => {
    expect(() => g.denyIf((u) => u?.role === 'member', bob)).toThrow(AuthorizationError)
    expect(() => g.denyIf(false, admin)).not.toThrow()
  })
})

// ── default gate ────────────────────────────────────────────────────────────
describe('default gate()', () => {
  test('setDefaultGate wires the process-wide accessor', () => {
    const configured = createGate<User>().define('admin', (u) => u?.role === 'admin')
    setDefaultGate(configured)
    expect(gate<User>().allows('admin', admin)).toBe(true)
    expect(gate<User>().allows('admin', bob)).toBe(false)
  })
})
