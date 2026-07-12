import { FormRequest } from '@elysia-ravel/validation'

/** Validates the payload for creating a user — Laravel-style rules & messages. */
export class StoreUserRequest extends FormRequest {
  override authorize() {
    return true
  }

  rules() {
    return {
      name: 'required|string|max:255',
      email: 'required|email|unique:users,email',
      password: 'required|min:8|confirmed',
    }
  }

  override messages() {
    return { 'email.unique': 'That email address is already registered.' }
  }
}

export default StoreUserRequest
