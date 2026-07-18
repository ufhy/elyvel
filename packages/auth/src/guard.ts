import type { AuthManager } from './manager'
import type { Authenticatable } from './types'
import { trans } from '@elysia-ravel/support'
import { Elysia } from 'elysia'

const BEARER = 'Bearer '

/**
 * Build an Elysia plugin that:
 *  - derives `user` (the authenticated user, or `null`) and `authToken` into
 *    the request context — typed from your user model;
 *  - adds an `auth` macro so a route can require authentication with
 *    `{ auth: true }`, returning 401 otherwise.
 *
 * The return type is intentionally inferred so the `user` decoration flows to
 * every route that uses this plugin — end-to-end type-safety, no casts.
 */
export function createGuard<U extends Authenticatable>(manager: AuthManager<U>) {
  return new Elysia({ name: 'ravel-auth' })
    .derive({ as: 'scoped' }, async ({ headers }) => {
      const header = headers.authorization
      const token = header?.startsWith(BEARER) ? header.slice(BEARER.length) : null
      const user = token ? await manager.user(token) : null
      return { user, authToken: token }
    })
    .macro({
      auth(enabled: boolean) {
        return {
          beforeHandle({ user, status }) {
            if (enabled && !user) {
              return status(401, { message: trans('errors.unauthenticated', {}, 'Unauthenticated') })
            }
          },
        }
      },
    })
}
