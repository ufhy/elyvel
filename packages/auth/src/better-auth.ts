import { app, expectsJson, route } from '@elysia-ravel/core'
import { Elysia } from 'elysia'
import { gate } from './gate'
import { AuthToken } from './provider'

/**
 * The authenticated user derived into request context (Better Auth's user +
 * common plugin fields). This is the type of `ctx.user` in route handlers.
 */
export interface User {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image?: string | null
  createdAt?: Date
  updatedAt?: Date
  twoFactorEnabled?: boolean | null
}

/** The parts of a Better Auth instance this plugin needs (kept loose to avoid deep generics). */
export interface BetterAuthLike {
  handler(request: Request): Response | Promise<Response>
  api: { getSession(args: { headers: Headers }): Promise<any> }
}

export interface BetterAuthPluginOptions {
  /** Where Better Auth's routes are mounted. Default `/api/auth`. */
  basePath?: string
  /**
   * Where to send a guest who hits a protected PAGE (a browser/Inertia
   * navigation). API/JSON requests still get a 401. Default `/login`.
   */
  loginPath?: string
  /** Where to send an authenticated-but-unverified user on a page. Default `/verify-email`. */
  verifyPath?: string
}

/**
 * Mount Better Auth into elysia-ravel: routes at `/api/auth/*`, a derived
 * `user`/`session` in context, and an `{ auth: true }` macro that 401s guests.
 *
 *   route().use(betterAuthPlugin()).get('/me', ({ user }) => user, { auth: true })
 *
 * The instance defaults to the one bound by `AuthServiceProvider`, resolved
 * lazily at request time via `app(AuthToken)` — so routes need not import it.
 * Pass an explicit instance to override.
 */
export function betterAuthPlugin(auth?: BetterAuthLike, options: BetterAuthPluginOptions = {}) {
  const base = (options.basePath ?? '/api/auth').replace(/\/$/, '')
  const loginPath = options.loginPath ?? '/login'
  const verifyPath = options.verifyPath ?? '/verify-email'
  const redirectTo = (to: string) => new Response(null, { status: 302, headers: { location: to } })
  // Resolved per request: the binding isn't ready until AuthServiceProvider has
  // booted, which happens after route modules load.
  const resolve = (): BetterAuthLike => auth ?? app(AuthToken)
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
        return resolve().handler(req)
      })
      // Derive the authenticated `user` + `authSession`, plus authorization
      // helpers bound to that user (Laravel's `$user->can()` / `Gate::authorize`).
      // NB: not named `session` — that would clobber the framework's cookie-session.
      .derive({ as: 'global' }, async ({ request }: any) => {
        const result = await resolve().api.getSession({ headers: request.headers })
        const user: User | null = result?.user ?? null
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
          if (!enabled)
            return {}
          return {
            beforeHandle({ user, status, request }: any) {
              if (!user)
                return !expectsJson(request) ? redirectTo(loginPath) : status(401, { message: 'Unauthenticated' })
            },
          }
        },
        // Require an authenticated AND email-verified user (Laravel's `verified`
        // middleware). Page navigations redirect (to login / the verify notice);
        // API/JSON requests get 401 / 403.
        verified(enabled: boolean) {
          if (!enabled)
            return {}
          return {
            beforeHandle({ user, status, request }: any) {
              if (!user)
                return !expectsJson(request) ? redirectTo(loginPath) : status(401, { message: 'Unauthenticated' })
              if (!user.emailVerified)
                return !expectsJson(request) ? redirectTo(verifyPath) : status(403, { message: 'Your email address is not verified.' })
            },
          }
        },
        // Guard a route by ability: `{ can: 'admin' }` or `{ can: ['update', ctx => ctx.post] }`.
        // Resolver functions receive the request context; other values pass through as args.
        can(config: string | any[]) {
          if (!config)
            return {}
          return {
            beforeHandle(ctx: any) {
              const [ability, ...resolvers] = Array.isArray(config) ? config : [config]
              const args = resolvers.map(r => (typeof r === 'function' ? r(ctx) : r))
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

/**
 * A `route()` with Better Auth wired in — handlers get a typed `user`
 * (`User | null`) and the `{ middleware: 'auth' }` guard, with no `.use` or
 * `: any` at the call site:
 *
 *   webRoute().get('/dashboard', ({ user }) => user, { middleware: 'auth' })
 *
 * The plugin is deduped by name, so mounting it per route file adds only the
 * types — the handler + session derive still run once per request.
 */
export function webRoute(prefix?: string, options: { middleware?: string[] } = {}) {
  return route(prefix, options).use(betterAuthPlugin())
}
