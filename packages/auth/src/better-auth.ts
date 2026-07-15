import { Elysia } from 'elysia'
import { gate } from './gate'

/** The parts of a Better Auth instance this plugin needs (kept loose to avoid deep generics). */
export interface BetterAuthLike {
  handler: (request: Request) => Response | Promise<Response>
  api: { getSession: (args: { headers: Headers }) => Promise<any> }
}

export interface BetterAuthPluginOptions {
  /** Where Better Auth's routes are mounted. Default `/api/auth`. */
  basePath?: string
}

/**
 * Mount Better Auth into elysia-ravel: routes at `/api/auth/*`, a derived
 * `user`/`session` in context, and an `{ auth: true }` macro that 401s guests.
 * Use it in a route file like `auth.guard()`:
 *
 *   route().use(betterAuthPlugin(auth)).get('/me', ({ user }) => user, { auth: true })
 */
export function betterAuthPlugin(auth: BetterAuthLike, options: BetterAuthPluginOptions = {}) {
  const base = (options.basePath ?? '/api/auth').replace(/\/$/, '')
  return (
    new Elysia({ name: 'ravel-better-auth' })
      // Rebuild the request from Elysia's parsed body — other global plugins may
      // have already consumed the stream, and Better Auth reads request.json().
      .all(`${base}/*`, ({ request, body }: any) => {
        const hasBody = body != null && request.method !== 'GET' && request.method !== 'HEAD'
        const req = hasBody
          ? new Request(request.url, {
              method: request.method,
              headers: request.headers,
              body: typeof body === 'string' ? body : JSON.stringify(body),
            })
          : request
        return auth.handler(req)
      })
      // Derive the authenticated `user` + `authSession`, plus authorization
      // helpers bound to that user (Laravel's `$user->can()` / `Gate::authorize`).
      // NB: not named `session` — that would clobber the framework's cookie-session.
      .derive({ as: 'scoped' }, async ({ request }: any) => {
        const result = await auth.api.getSession({ headers: request.headers })
        const user = result?.user ?? null
        const g = gate().forUser(user)
        return {
          user,
          authSession: result?.session ?? null,
          can: (ability: string, ...args: any[]) => g.allows(ability, ...args),
          cannot: (ability: string, ...args: any[]) => g.denies(ability, ...args),
          authorize: (ability: string, ...args: any[]) => g.authorize(ability, ...args),
        }
      })
      .macro({
        auth(enabled: boolean) {
          if (!enabled) return {}
          return {
            beforeHandle({ user, status }: any) {
              if (!user) return status(401, { message: 'Unauthenticated' })
            },
          }
        },
        // Require an authenticated AND email-verified user (Laravel's `verified`
        // middleware): 401 for guests, 403 when the email isn't verified yet.
        verified(enabled: boolean) {
          if (!enabled) return {}
          return {
            beforeHandle({ user, status }: any) {
              if (!user) return status(401, { message: 'Unauthenticated' })
              if (!user.emailVerified)
                return status(403, { message: 'Your email address is not verified.' })
            },
          }
        },
        // Guard a route by ability: `{ can: 'admin' }` or `{ can: ['update', ctx => ctx.post] }`.
        // Resolver functions receive the request context; other values pass through as args.
        can(config: string | any[]) {
          if (!config) return {}
          return {
            beforeHandle(ctx: any) {
              const [ability, ...resolvers] = Array.isArray(config) ? config : [config]
              const args = resolvers.map((r) => (typeof r === 'function' ? r(ctx) : r))
              if (
                !gate()
                  .forUser(ctx.user)
                  .allows(ability, ...args)
              ) {
                return ctx.status(403, { message: 'This action is unauthorized.' })
              }
            },
          }
        },
      })
  )
}
