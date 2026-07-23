import type { AuthRequestClass } from './auth-requests'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { AuthActions } from './auth-requests'

/** Marker code the error normalizer recognizes to pass a pre-built error bag through. */
export const ELYVEL_VALIDATION = 'ELYVEL_VALIDATION'

/**
 * Better Auth endpoint path → the bound FormRequest that validates its body.
 * Read lazily (getters) so a swap via {@link AuthActions} after boot applies.
 */
const REQUEST_FOR: Record<string, () => AuthRequestClass> = {
  '/sign-up/email': () => AuthActions.register,
  '/reset-password': () => AuthActions.resetPassword,
  '/change-password': () => AuthActions.updatePassword,
  '/update-user': () => AuthActions.updateProfile,
}

/**
 * A Better Auth `before` hook that validates password/profile flows through the
 * bound FormRequests. Installed on the instance by `defineAuth`, so it runs for
 * BOTH the HTTP routes and programmatic `auth.api.*` calls — a custom route
 * calling the server API is validated too, no route interception needed. The
 * app-wide `Password.defaults()` policy therefore applies to registration,
 * password reset, and password change alike.
 *
 * On failure it throws an `APIError` carrying elyvel's already-translated,
 * Laravel-shaped error bag; the catch-all normalizer forwards it verbatim.
 */
export const registrationHook = createAuthMiddleware(async (ctx: any) => {
  const request = REQUEST_FOR[ctx.path]?.()
  if (!request)
    return
  try {
    await request.validate({ body: ctx.body })
  }
  catch (error: any) {
    if (error?.isValidationException) {
      throw new APIError('UNPROCESSABLE_ENTITY', {
        code: ELYVEL_VALIDATION,
        message: error.message,
        errors: error.errors,
      })
    }
    throw error
  }
})

/**
 * Compose elyvel's `before` hook with any the app already declared in
 * `config/auth.ts` — ours runs first (so a rejection short-circuits), then the
 * app's, whose context-merge return value (if any) wins.
 */
export function composeBefore(appBefore?: any): any {
  if (!appBefore)
    return registrationHook
  return createAuthMiddleware(async (ctx: any) => {
    await registrationHook(ctx)
    return appBefore(ctx)
  })
}
