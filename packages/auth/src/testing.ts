import type { User } from './better-auth'

/**
 * Test-only authentication seam (Laravel's `actingAs`). When an actor is set,
 * `betterAuthPlugin`'s global derive uses it instead of resolving a Better Auth
 * session from request cookies — so tests can authenticate without signing in.
 *
 * `undefined` means "not overriding" (normal session resolution); `null` means
 * "acting as a guest" (force unauthenticated). The default is `undefined`, so
 * production requests are never affected.
 */
let actor: User | null | undefined

/** Authenticate every subsequent request as `user` until {@link stopActingAs}. */
export function actingAs(user: User): void {
  actor = user
}

/** Force subsequent requests to be unauthenticated (a guest). */
export function actingAsGuest(): void {
  actor = null
}

/** Clear the test actor and resume normal cookie-session resolution. */
export function stopActingAs(): void {
  actor = undefined
}

/** The current test actor: a user, `null` (guest), or `undefined` (no override). */
export function currentTestActor(): User | null | undefined {
  return actor
}
