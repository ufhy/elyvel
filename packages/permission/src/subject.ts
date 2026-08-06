/**
 * Who a role is attached to, reduced to the two columns the pivot stores:
 * a `model_type` and a `model_id`. Everything in this package works on that
 * pair, which is what lets roles attach to any model at all.
 *
 * It also solves a real mismatch. `ctx.user` in an elyvel app is whatever the
 * auth layer derived — with Better Auth that's a plain object
 * (`{ id, email, ... }`), NOT an Eloquent model. Reading `constructor.name`
 * off it would record `model_type: 'Object'` and quietly file every user's
 * roles under the same meaningless type. So the middleware resolves a subject
 * explicitly instead: from a real model when it has one, and otherwise from
 * `permission.userModel` plus the user's id — no extra query needed, since
 * type and id are all the pivot ever holds.
 */
import type { Model } from '@elyvel/database'
import { permissionConfig } from './registrar'

export interface Subject {
  /** Stored in `model_type` — the model class name. */
  type: string
  /** Stored in `model_id`, always as a string so TEXT and integer ids both work. */
  id: string
}

/** Is this an Eloquent model instance rather than a plain auth object? */
function isModel(value: object): value is Model {
  const ctor = value.constructor as { primaryKey?: unknown } | undefined
  return typeof ctor?.primaryKey === 'string'
}

export function subjectOf(model: Model): Subject {
  const primaryKey = (model.constructor as unknown as { primaryKey: string }).primaryKey
  return {
    type: model.constructor.name,
    id: String((model as unknown as Record<string, unknown>)[primaryKey]),
  }
}

/**
 * The subject for whatever the auth layer put on the request, or `undefined`
 * when there is nobody (or nothing usable). Never guesses a type: an app whose
 * `ctx.user` is a plain object must name its model in `config/permission.ts`,
 * because guessing would silently write roles under the wrong `model_type`.
 */
export function subjectFromUser(user: unknown): Subject | undefined {
  if (user === null || typeof user !== 'object')
    return undefined

  if (isModel(user))
    return subjectOf(user)

  const id = (user as { id?: unknown }).id
  if (id === undefined || id === null)
    return undefined

  const userModel = permissionConfig()?.userModel
  if (!userModel) {
    throw new Error(
      '[permission] The authenticated user is not an Eloquent model, so its `model_type` is unknown. '
      + 'Set `userModel` in config/permission.ts (e.g. `userModel: AuthUser`) so roles are recorded '
      + 'under the same type your code assigns them with.',
    )
  }

  return { type: userModel.name, id: String(id) }
}
