import type { Data, Rules, ValidatorOptions } from './validator'
import { Validator } from './validator'

/** Thrown when a FormRequest's `authorize()` returns false. */
export class AuthorizationException extends Error {
  readonly status = 403
  readonly isAuthorizationException = true
  constructor(message = 'This action is unauthorized.') {
    super(message)
    this.name = 'AuthorizationException'
  }
}

/** Minimal request context a FormRequest reads (Elysia context is compatible). */
export interface RequestLike {
  body?: unknown
  [key: string]: unknown
}

/**
 * Laravel-style Form Request. Subclass it, define `rules()` (and optionally
 * `authorize`/`messages`/`attributes`), then `await MyRequest.validate(ctx)` in
 * a handler — it returns the validated data or throws (403 / 422).
 */
export abstract class FormRequest {
  /**
   * The validation rules. Receives the same context passed to `validate()` —
   * useful for route-model-bound updates, e.g. excluding the current row from
   * a `unique` check: `` `unique:posts,slug,${(ctx.model as Post).id}` ``.
   */
  abstract rules(ctx: RequestLike): Rules

  authorize(_ctx: RequestLike): boolean | Promise<boolean> {
    return true
  }

  messages(): Record<string, string> {
    return {}
  }

  attributes(): Record<string, string> {
    return {}
  }

  /** Authorize, then validate `ctx.body`. Returns validated data or throws. */
  static async validate<T extends FormRequest>(this: new () => T, ctx: RequestLike): Promise<Data> {
    const instance = new this()
    if (!(await instance.authorize(ctx)))
      throw new AuthorizationException()

    const data: Data = ctx.body && typeof ctx.body === 'object' ? (ctx.body as Data) : {}
    const options: ValidatorOptions = {
      messages: instance.messages(),
      attributes: instance.attributes(),
    }
    return Validator.make(data, instance.rules(ctx), options).validate()
  }
}
