import type { Data, RequestLike, Rules } from '@elyvel/validation'
import { FormRequest, Password } from '@elyvel/validation'

/**
 * A FormRequest class usable as an auth action — a concrete subclass with the
 * inherited static `validate()`. This is the type the registrar stores/swaps.
 */
export type AuthRequestClass = (new () => FormRequest) & {
  validate(ctx: RequestLike): Promise<Data>
}

/**
 * Default registration validation (Laravel Fortify's `CreateNewUser` analog).
 * Validation lives in the request, not in the plumbing that wraps Better Auth.
 * `password` uses the app-wide `Password.defaults()` policy (falling back to a
 * plain `min(8)`), so complexity rules set once apply to registration too.
 *
 * Swap it wholesale via {@link AuthActions.registerUsing} to add fields, change
 * rules, or require confirmation — without touching any route or Better Auth.
 */
export class RegisterRequest extends FormRequest {
  rules(): Rules {
    return {
      name: 'required|string|max:255',
      email: 'required|email',
      password: ['required', 'string', Password.default()],
    }
  }
}

/**
 * Default reset-password validation. `newPassword` uses the app-wide policy, so
 * the same complexity rules apply here as at registration — one definition,
 * every password-touching flow (Laravel's `Password::default()` reach).
 */
export class ResetPasswordRequest extends FormRequest {
  rules(): Rules {
    return {
      token: 'required|string',
      newPassword: ['required', 'string', Password.default()],
    }
  }
}

/** Default change-password validation (authenticated). `newPassword` uses the policy. */
export class UpdatePasswordRequest extends FormRequest {
  rules(): Rules {
    return {
      currentPassword: 'required|string',
      newPassword: ['required', 'string', Password.default()],
    }
  }
}

/** Default profile-update validation. Fields are optional — only what's sent is checked. */
export class UpdateProfileRequest extends FormRequest {
  rules(): Rules {
    return {
      name: 'sometimes|string|max:255',
      image: 'sometimes|string',
    }
  }
}

const bindings = {
  register: RegisterRequest as AuthRequestClass,
  resetPassword: ResetPasswordRequest as AuthRequestClass,
  updatePassword: UpdatePasswordRequest as AuthRequestClass,
  updateProfile: UpdateProfileRequest as AuthRequestClass,
}

/**
 * Registry of swappable auth actions (Laravel Fortify's `Fortify::createUsersUsing`
 * / `resetUserPasswordsUsing` analog). Bind your own FormRequest subclasses in a
 * service provider's `boot()`; the framework reads the current binding at request
 * time, so a swap after boot still takes effect.
 */
export const AuthActions = {
  /** Swap the FormRequest that validates registration. */
  registerUsing(request: AuthRequestClass): void {
    bindings.register = request
  },
  /** Swap the FormRequest that validates password reset. */
  resetPasswordUsing(request: AuthRequestClass): void {
    bindings.resetPassword = request
  },
  /** Swap the FormRequest that validates password changes. */
  updatePasswordUsing(request: AuthRequestClass): void {
    bindings.updatePassword = request
  },
  /** Swap the FormRequest that validates profile updates. */
  updateProfileUsing(request: AuthRequestClass): void {
    bindings.updateProfile = request
  },
  get register(): AuthRequestClass {
    return bindings.register
  },
  get resetPassword(): AuthRequestClass {
    return bindings.resetPassword
  },
  get updatePassword(): AuthRequestClass {
    return bindings.updatePassword
  },
  get updateProfile(): AuthRequestClass {
    return bindings.updateProfile
  },
}
