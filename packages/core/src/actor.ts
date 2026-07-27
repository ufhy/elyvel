/**
 * The "current actor" — whoever is making the current request — resolved
 * concurrency-safely with AsyncLocalStorage, so parallel requests never see
 * each other's id. Powers `@elyvel/database`'s `userstamps` (`created_by`/
 * `updated_by`/`deleted_by`), populated automatically without threading a
 * user id through every `Model.save()` call.
 *
 * Uses a mutable "box" rather than a plain value: the scope is opened empty as
 * early as possible in the request (`requestContext()`'s `onRequest`, before
 * any `await`), then filled in later once auth resolves the user — usually
 * inside an async `.derive()` (e.g. `betterAuthPlugin`'s). Entering the scope
 * with a plain value at that later point wouldn't propagate on Bun (`enterWith`
 * called after an internal `await` doesn't reach the awaiting caller's
 * continuation) — mutating a box entered earlier does, since it's the same
 * object reference throughout. Verified concurrency-safe under parallel
 * requests before relying on it here.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

interface ActorBox {
  id: unknown
}

const actorStore = new AsyncLocalStorage<ActorBox>()

/** The signed-in actor's id for the current request, or `undefined` outside one / before auth resolves. */
export function currentActorId(): unknown {
  return actorStore.getStore()?.id
}

/** Open an empty actor scope for the rest of the current async continuation (call once, as early as possible per request). */
export function beginActorScope(): void {
  actorStore.enterWith({ id: undefined })
}

/** Fill in the actor id once it's known (e.g. after an auth plugin resolves the session user). */
export function setCurrentActor(id: unknown): void {
  const box = actorStore.getStore()
  if (box)
    box.id = id
}

/**
 * Run `fn` with `id` active as the actor for its entire async continuation —
 * for contexts with no request lifecycle to hook into (a queue job, a
 * seeder, a test): a plain `.run()`, no box needed since the value is known
 * upfront.
 */
export function runWithActor<T>(id: unknown, fn: () => T): T {
  return actorStore.run({ id }, fn)
}
