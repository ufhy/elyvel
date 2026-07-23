import { app, config, expectsJson, route } from '@elyvel/core'
import { trans } from '@elyvel/support'
import { Elysia } from 'elysia'
import { normalizeAuthError } from './error-normalizer'
import { gate } from './gate'
import { AuthToken } from './provider'
import { currentTestActor } from './testing'

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
  /**
   * An explicit Better Auth instance. Defaults to the one bound by
   * `AuthServiceProvider`, resolved lazily at request time via `app(AuthToken)`
   * — so routes need not import it. Pass one to override (used by tests).
   */
  instance?: BetterAuthLike
  /** Where Better Auth's routes are mounted. Default `/api/auth`. */
  basePath?: string
}

/**
 * Mount Better Auth into elyvel: routes at `/api/auth/*`, a derived
 * `user`/`session` in context, and an `{ auth: true }` macro that 401s guests.
 *
 *   route().use(betterAuthPlugin()).get('/me', ({ user }) => user, { auth: true })
 *
 * Registration validation lives on the instance (a Better Auth `before` hook,
 * see define-auth.ts), so this plugin only proxies `/api/auth/*`, normalizes
 * error envelopes, derives `user`, and provides the guard macros. Error
 * responses (from any auth route) are reshaped into the framework's translated
 * `{ message, errors }` envelope by {@link normalizeAuthError}.
 */
export function betterAuthPlugin(options: BetterAuthPluginOptions = {}) {
  const base = (options.basePath ?? '/api/auth').replace(/\/$/, '')
  const redirectTo = (to: string) => new Response(null, { status: 302, headers: { location: to } })
  // Single source for redirect targets: `config('auth.*')` in config/auth.ts —
  // the same values `AuthGuard`/`VerifiedGuard` read, so the macro and the
  // middleware guards never disagree. Read per request (config is ready by then).
  // Falls back to the default if config isn't booted (e.g. the plugin mounted
  // bare in a unit test), so the macro never 500s on a missing repository.
  const readPath = (key: string, fallback: string): string => {
    try {
      return config<string>(key, fallback)
    }
    catch {
      return fallback
    }
  }
  const loginPath = (): string => readPath('auth.loginPath', '/login')
  const verifyPath = (): string => readPath('auth.verifyPath', '/verify-email')
  // Resolved per request: the binding isn't ready until AuthServiceProvider has
  // booted, which happens after route modules load.
  const resolve = (): BetterAuthLike => options.instance ?? app(AuthToken)
  // Rebuild the request from Elysia's parsed body — other global plugins may
  // have already consumed the stream, and Better Auth reads request.json().
  const rebuild = (request: Request, body: unknown): Request => {
    const hasBody = body != null && request.method !== 'GET' && request.method !== 'HEAD'
    return hasBody
      ? new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: typeof body === 'string' ? body : JSON.stringify(body),
        })
      : request
  }
  return (
    new Elysia({ name: 'elyvel-better-auth' })
      .all(`${base}/*`, async ({ request, body }: any) => normalizeAuthError(await resolve().handler(rebuild(request, body))))
      // Derive the authenticated `user` + `authSession`, plus authorization
      // helpers bound to that user (Laravel's `$user->can()` / `Gate::authorize`).
      // NB: not named `session` — that would clobber the framework's cookie-session.
      .derive({ as: 'global' }, async ({ request }: any) => {
        // Test seam: `actingAs(user)` short-circuits session resolution. Defaults
        // to off (`undefined`), so real requests always hit Better Auth.
        const override = currentTestActor()
        let user: User | null
        let authSession: unknown
        if (override !== undefined) {
          user = override
          authSession = override ? { userId: (override as { id?: unknown }).id } : null
        }
        else {
          const result = await resolve().api.getSession({ headers: request.headers })
          user = result?.user ?? null
          authSession = result?.session ?? null
        }
        const g = gate().forUser(user)
        return {
          user,
          authSession: authSession ?? null,
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
                return !expectsJson(request) ? redirectTo(loginPath()) : status(401, { message: trans('auth::errors.unauthenticated', {}, 'Unauthenticated') })
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
                return !expectsJson(request) ? redirectTo(loginPath()) : status(401, { message: trans('auth::errors.unauthenticated', {}, 'Unauthenticated') })
              if (!user.emailVerified)
                return !expectsJson(request) ? redirectTo(verifyPath()) : status(403, { message: trans('auth::errors.unverified', {}, 'Your email address is not verified.') })
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
                return ctx.status(403, { message: trans('auth::errors.unauthorized', {}, 'This action is unauthorized.') })
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
