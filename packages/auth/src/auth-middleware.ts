import { expectsJson, Middleware } from '@elysia-ravel/core'

/** Where to send a guest / unverified user hitting a protected PAGE (browser). */
const LOGIN_PATH = '/login'
const VERIFY_PATH = '/verify-email'

function redirect(to: string): Response {
  return new Response(null, { status: 302, headers: { location: to } })
}

/**
 * `{ middleware: 'auth' }` — require an authenticated user. Reads `user` from
 * context (derived globally by `betterAuthPlugin`). Browser navigations are
 * redirected to `/login`; API/JSON requests get a 401. Laravel's `auth` middleware.
 */
export class AuthGuard extends Middleware {
  handle(ctx: any): unknown {
    if (!ctx.user) {
      return expectsJson(ctx.request)
        ? ctx.status(401, { message: 'Unauthenticated' })
        : redirect(LOGIN_PATH)
    }
  }
}

/**
 * `{ middleware: 'verified' }` — require an authenticated AND email-verified
 * user. Laravel's `verified` middleware. Browsers redirect (to login / the
 * verify notice); API/JSON requests get 401 / 403.
 */
export class VerifiedGuard extends Middleware {
  handle(ctx: any): unknown {
    if (!ctx.user) {
      return expectsJson(ctx.request)
        ? ctx.status(401, { message: 'Unauthenticated' })
        : redirect(LOGIN_PATH)
    }
    if (!ctx.user.emailVerified) {
      return expectsJson(ctx.request)
        ? ctx.status(403, { message: 'Your email address is not verified.' })
        : redirect(VERIFY_PATH)
    }
  }
}
