import { describe, expect, test } from 'bun:test'
import { JsonResource } from '../src/http/resources'

interface User {
  id: number
  name: string
  email: string
  deleted_at?: string | null
  relations?: Record<string, unknown>
}

class UserResource extends JsonResource<User> {
  private readonly isOwner: boolean

  constructor(user: User, isOwner = false) {
    super(user)
    this.isOwner = isOwner
  }

  toArray(): Record<string, unknown> {
    return {
      id: this.resource.id,
      name: this.resource.name,
      // Only the owner sees their address — the key is absent for everyone else.
      email: this.when(this.isOwner, this.resource.email),
      deleted_at: this.whenNotNull(this.resource.deleted_at),
      posts: this.whenLoaded('posts'),
      ...{},
    }
  }
}

const user = (over: Partial<User> = {}): User => ({ id: 1, name: 'Ada', email: 'ada@example.com', ...over })

/**
 * Without a transformation layer a controller either returns the model — leaking
 * every column the day someone adds one — or hand-rolls an object per endpoint,
 * which drifts between the list and detail views of the same resource.
 */
describe('JsonResource', () => {
  test('wraps in `data` by default, like Laravel', () => {
    expect(new UserResource(user()).toJSON()).toEqual({ data: { id: 1, name: 'Ada' } })
  })

  /**
   * The distinction that matters: an omitted key is not `null`. A client that
   * reads `"email" in payload` to decide whether it may edit it would be told
   * yes by a null.
   */
  test('when(false) omits the key entirely, rather than sending null', () => {
    const json = new UserResource(user()).toJSON() as { data: Record<string, unknown> }
    expect('email' in json.data).toBe(false)

    const owner = new UserResource(user(), true).toJSON() as { data: Record<string, unknown> }
    expect(owner.data.email).toBe('ada@example.com')
  })

  test('whenNotNull keeps a real value and drops null/undefined', () => {
    const alive = new UserResource(user()).toJSON() as { data: Record<string, unknown> }
    expect('deleted_at' in alive.data).toBe(false)

    const gone = new UserResource(user({ deleted_at: '2026-01-01' })).toJSON() as { data: Record<string, unknown> }
    expect(gone.data.deleted_at).toBe('2026-01-01')
  })

  /**
   * The N+1 guard: reading `user.posts` unconditionally in a serialiser issues a
   * query per row, from the layer least likely to be profiled.
   */
  test('whenLoaded omits a relation that was never eager-loaded', () => {
    const bare = new UserResource(user()).toJSON() as { data: Record<string, unknown> }
    expect('posts' in bare.data).toBe(false)

    const loaded = new UserResource(user({ relations: { posts: [{ id: 9 }] } })).toJSON() as {
      data: Record<string, unknown>
    }
    expect(loaded.data.posts).toEqual([{ id: 9 }])
  })

  test('additional() adds top-level keys beside the envelope', () => {
    expect(new UserResource(user()).additional({ meta: { version: 2 } }).toJSON())
      .toEqual({ data: { id: 1, name: 'Ada' }, meta: { version: 2 } })
  })

  test('wrapIn(null) returns the payload bare', () => {
    expect(new UserResource(user()).wrapIn(null).toJSON()).toEqual({ id: 1, name: 'Ada' })
  })

  test('mergeWhen spreads keys into the parent, or contributes nothing', () => {
    class Admin extends JsonResource<User> {
      constructor(u: User, private readonly isAdmin: boolean) {
        super(u)
      }

      toArray(): Record<string, unknown> {
        return {
          id: this.resource.id,
          secrets: this.mergeWhen(this.isAdmin, { internal_id: 42, flags: ['a'] }),
        }
      }
    }

    expect(new Admin(user(), true).toJSON()).toEqual({ data: { id: 1, internal_id: 42, flags: ['a'] } })
    expect(new Admin(user(), false).toJSON()).toEqual({ data: { id: 1 } })
  })

  test('collection() wraps a list under one envelope', () => {
    const json = UserResource.collection([user(), user({ id: 2, name: 'Grace' })]).toJSON()
    expect(json).toEqual({ data: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Grace' }] })
  })

  test('a collection carries pagination meta', () => {
    const json = UserResource.collection([user()]).additional({ meta: { total: 1, page: 1 } }).toJSON()
    expect(json).toEqual({ data: [{ id: 1, name: 'Ada' }], meta: { total: 1, page: 1 } })
  })

  /** The sentinel must never reach the wire — a symbol is not serialisable. */
  test('nested resources are filtered too, so no sentinel leaks out', () => {
    class Wrapper extends JsonResource<User> {
      toArray(): Record<string, unknown> {
        return { nested: new UserResource(this.resource).resolve() }
      }
    }
    const json = JSON.stringify(new Wrapper(user()).toJSON())
    expect(json).toBe('{"data":{"nested":{"id":1,"name":"Ada"}}}')
  })
})

/**
 * Regression, and an unusual one: `eslint --fix` rewrote `whenNotNull`'s body
 * into `value ?? fallback === undefined ? MISSING : fallback`, which parses as
 * `(value ?? (fallback === undefined)) ? …` and therefore dropped every value it
 * was meant to keep. The tests above happened to run before the fixer did. These
 * pin the behaviour for each shape of input so a formatter can't quietly invert
 * it again.
 */
describe('whenNotNull, value by value', () => {
  class Probe extends JsonResource<{ v: unknown }> {
    toArray(): Record<string, unknown> {
      return { v: this.whenNotNull(this.resource.v) }
    }
  }

  const out = (v: unknown) => (new Probe({ v }).toJSON() as { data: Record<string, unknown> }).data

  test('keeps values that are merely falsy', () => {
    expect(out(0)).toEqual({ v: 0 })
    expect(out('')).toEqual({ v: '' })
    expect(out(false)).toEqual({ v: false })
    expect(out(Number.NaN)).toEqual({ v: Number.NaN })
  })

  test('drops null and undefined only', () => {
    expect(out(null)).toEqual({})
    expect(out(undefined)).toEqual({})
  })

  test('uses the fallback when one is given', () => {
    class WithFallback extends JsonResource<{ v: unknown }> {
      toArray(): Record<string, unknown> {
        return { v: this.whenNotNull(this.resource.v, 'unknown') }
      }
    }
    expect((new WithFallback({ v: null }).toJSON() as { data: Record<string, unknown> }).data)
      .toEqual({ v: 'unknown' })
  })
})
