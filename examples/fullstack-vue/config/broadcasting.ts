import type { User } from '@elyvel/auth'
import { AuthToken, currentTestActor } from '@elyvel/auth'
import { defineBroadcastConfig } from '@elyvel/broadcasting'
import { app } from '@elyvel/core'

/**
 * Broadcasting driver. `websocket` (this app's default) uses Bun's native
 * WebSocket pub/sub, so new blog comments show up live for anyone else
 * viewing the same post — see `resources/js/Pages/Blog/Show.vue`.
 *
 * `authenticate` resolves the connecting client's Better Auth session from the
 * raw upgrade request's cookies (the same `getSession` betterAuthPlugin uses
 * for ordinary HTTP requests) — needed because `private-posts.{id}` (see
 * `AppServiceProvider`'s `channel()` rule) must tell an anonymous viewer of a
 * PUBLISHED post apart from a non-author trying to peek at an unpublished
 * one. Returns `null` for a guest, which is fine — only the unpublished-post
 * case actually requires an identity. Honors the same `actingAs()` test seam
 * betterAuthPlugin's HTTP derive does, so tests don't need a real session cookie.
 */
export default defineBroadcastConfig({
  driver: (process.env.BROADCAST_DRIVER as 'websocket' | 'log' | 'array' | undefined) ?? 'websocket',
  async authenticate(request) {
    const override = currentTestActor()
    if (override !== undefined)
      return override
    const result = await app(AuthToken).api.getSession({ headers: request.headers })
    return (result?.user as User | undefined) ?? null
  },
})
