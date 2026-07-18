import type { MiddlewareContext } from '@elyvel/core'
import type { User } from './better-auth'
import { config, expectsJson, Middleware } from '@elyvel/core'

/**
 * Where to send a guest hitting a protected PAGE (browser). Overridable via
 *  `config('auth.loginPath')` in config/auth.ts; defaults to `/login`.
 */
function loginPath(): string {
  return config<string>('auth.loginPath', '/login')
}

/** Where to send an authenticated-but-unverified user. `config('auth.verifyPath')`. */
function verifyPath(): string {
  return config<string>('auth.verifyPath', '/verify-email')
}

function redirect(to: string): Response {
  return new Response(null, { status: 302, headers: { location: to } })
}

/**
 * `{ middleware: 'auth' }` — require an authenticated user. Reads `user` from
 * context (derived globally by `betterAuthPlugin`). Browser navigations are
 * redirected to the login page; API/JSON requests get a 401. Laravel's `auth`.
 */
export class AuthGuard extends Middleware {
  handle(ctx: MiddlewareContext): unknown {
    const user = ctx.user as User | null
    if (!user) {
      return expectsJson(ctx.request)
        ? ctx.status(401, { message: 'Unauthenticated' })
        : redirect(loginPath())
    }
  }
}

/**
 * `{ middleware: 'verified' }` — require an authenticated AND email-verified
 * user. Laravel's `verified` middleware. Browsers redirect (to login / the
 * verify notice); API/JSON requests get 401 / 403.
 */
export class VerifiedGuard extends Middleware {
  handle(ctx: MiddlewareContext): unknown {
    const user = ctx.user as User | null
    if (!user) {
      return expectsJson(ctx.request)
        ? ctx.status(401, { message: 'Unauthenticated' })
        : redirect(loginPath())
    }
    if (!user.emailVerified) {
      return expectsJson(ctx.request)
        ? ctx.status(403, { message: 'Your email address is not verified.' })
        : redirect(verifyPath())
    }
  }
}
