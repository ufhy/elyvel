import { trans } from '@elyvel/support'

/**
 * Better Auth emits errors in a couple of shapes — a `{ code, message }` body
 * for in-handler failures, and better-call's own validation payload for
 * body-schema failures — with English, untranslated messages, and a few codes
 * that live outside its central catalog. This module normalizes the ones a
 * client actually sees into elyvel's single Laravel-style envelope:
 *
 *   { message, errors?: { field: string[] } }   // 422 for field-level failures
 *
 * so the auth flows read like every other validated request in the framework,
 * translated via the `auth::` namespace. Unknown codes pass through untouched.
 */
interface Mapping {
  /** Field to pin the message under (yields a 422 + error bag). Omit for form-level. */
  field?: string
  /** Translation key under the `auth::` namespace. */
  key: string
  /** English fallback when no translation is loaded. */
  fallback: string
  /** Override the response status; defaults to 422 when `field` is set, else the original. */
  status?: number
}

// Codes reachable by the email/password + session flows a client hits. Codes not
// listed here fall through with Better Auth's original response.
const CODES: Record<string, Mapping> = {
  USER_ALREADY_EXISTS: { field: 'email', key: 'register.email_taken', fallback: 'This email is already registered.' },
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: { field: 'email', key: 'register.email_taken', fallback: 'This email is already registered.' },
  INVALID_EMAIL: { field: 'email', key: 'errors.invalid_email', fallback: 'The email address is invalid.' },
  PASSWORD_TOO_SHORT: { field: 'password', key: 'errors.password_too_short', fallback: 'The password is too short.' },
  PASSWORD_TOO_LONG: { field: 'password', key: 'errors.password_too_long', fallback: 'The password is too long.' },
  INVALID_EMAIL_OR_PASSWORD: { key: 'errors.invalid_credentials', fallback: 'These credentials do not match our records.' },
  INVALID_PASSWORD: { key: 'errors.invalid_credentials', fallback: 'These credentials do not match our records.' },
  EMAIL_NOT_VERIFIED: { key: 'errors.unverified', fallback: 'Your email address is not verified.' },
  EMAIL_PASSWORD_SIGN_UP_DISABLED: { key: 'errors.sign_up_disabled', fallback: 'Registration is currently closed.', status: 403 },
  EMAIL_PASSWORD_DISABLED: { key: 'errors.email_password_disabled', fallback: 'Email and password sign-in is disabled.', status: 403 },
  RESET_PASSWORD_DISABLED: { key: 'errors.reset_disabled', fallback: 'Password reset is currently unavailable.', status: 403 },
}

/** Reshape a validation error bag into elyvel's translated `{ message, errors }` 422. */
export function validationEnvelope(errors: Record<string, string[]>): { body: { message: string, errors: Record<string, string[]> }, status: number } {
  const first = Object.values(errors).flat()[0]
    ?? trans('validation::exception.invalid', {}, 'The given data was invalid.')
  return { body: { message: first, errors }, status: 422 }
}

/**
 * Normalize a Better Auth error {@link Response}. Success responses and unknown
 * error codes are returned unchanged; recognized codes are reshaped into the
 * translated envelope (a 422 + error bag when the code maps to a field).
 */
export async function normalizeAuthError(res: Response): Promise<Response> {
  if (res.ok)
    return res
  const payload = (await res
    .clone()
    .json()
    .catch(() => null)) as { code?: string, message?: string, errors?: Record<string, string[]> } | null
  const code = payload?.code
  if (!code)
    return res

  // Our own validation hook (auth-hooks.ts) already produced a translated,
  // Laravel-shaped bag — forward it verbatim as the 422 envelope.
  if (code === 'ELYVEL_VALIDATION' && payload?.errors) {
    return Response.json({ message: payload.message, errors: payload.errors }, { status: 422 })
  }

  const map = CODES[code]
  if (!map)
    return res

  const message = trans(`auth::${map.key}`, {}, map.fallback)
  const status = map.status ?? (map.field ? 422 : res.status)
  const body = map.field
    ? { message, errors: { [map.field]: [message] } }
    : { message }
  return Response.json(body, { status })
}
