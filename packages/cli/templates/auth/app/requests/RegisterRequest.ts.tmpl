import type { Rules } from '@elyvel/validation'
import { FormRequest, Password } from '@elyvel/validation'

/**
 * Custom registration validation, bound via `AuthActions.registerUsing()` in
 * AppServiceProvider. Adds a `password_confirmation` requirement on top of the
 * app-wide `Password.defaults()` policy — demonstrating that a flow's rules are
 * swapped by replacing the FormRequest, not by touching the auth plumbing.
 *
 * `password_confirmation` is consumed only by the `confirmed` rule; it is not a
 * Better Auth field, so it never reaches (or is rejected by) the sign-up API.
 */
export class RegisterRequest extends FormRequest {
  rules(): Rules {
    return {
      name: 'required|string|max:255',
      email: 'required|email',
      password: ['required', 'string', 'confirmed', Password.default()],
    }
  }
}

export default RegisterRequest
