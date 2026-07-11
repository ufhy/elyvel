import type { Authenticatable } from './types'

export class AuthorizationError extends Error {
  readonly status = 403
  constructor(message = 'This action is unauthorized.') {
    super(message)
    this.name = 'AuthorizationError'
  }
}

type Ability<U> = (user: U | null, ...args: any[]) => boolean

/**
 * A minimal authorization gate — the Elysia-first take on Laravel's Gate.
 * Register named abilities, then check them. Policies are just abilities
 * grouped by convention (e.g. `post.update`).
 *
 * @example
 * const gate = createGate<User>()
 *   .define('post.update', (user, post: Post) => user?.id === post.authorId)
 *
 * gate.authorize('post.update', user, post) // throws AuthorizationError if denied
 */
export class Gate<U extends Authenticatable = Authenticatable> {
  private readonly abilities = new Map<string, Ability<U>>()

  define(ability: string, callback: Ability<U>): this {
    this.abilities.set(ability, callback)
    return this
  }

  allows(ability: string, user: U | null, ...args: any[]): boolean {
    const callback = this.abilities.get(ability)
    if (!callback) return false
    return callback(user, ...args)
  }

  denies(ability: string, user: U | null, ...args: any[]): boolean {
    return !this.allows(ability, user, ...args)
  }

  /** Throw {@link AuthorizationError} unless the ability is allowed. */
  authorize(ability: string, user: U | null, ...args: any[]): void {
    if (!this.allows(ability, user, ...args)) {
      throw new AuthorizationError()
    }
  }
}

export function createGate<U extends Authenticatable = Authenticatable>(): Gate<U> {
  return new Gate<U>()
}
