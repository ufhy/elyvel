import type { Static, TObject, TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

/**
 * Validate and coerce `process.env` against a TypeBox schema, failing fast at
 * boot with a readable error when required variables are missing or malformed.
 *
 * Use the `t` helper re-exported from `elysia` to build the schema so the
 * result stays type-safe end to end.
 *
 * @example
 * const env = defineEnv(t.Object({
 *   PORT: t.Number({ default: 3000 }),
 *   APP_ENV: t.Union([t.Literal('local'), t.Literal('production')]),
 * }))
 * env.PORT // typed as number
 */
export function defineEnv<T extends TObject>(
  schema: T,
  source: Record<string, unknown> = process.env,
): Static<T> {
  // Coerce strings ("3000", "true") into the schema's target primitives.
  const converted = Value.Convert(schema, source)
  const cleaned = Value.Clean(schema, converted)
  const withDefaults = Value.Default(schema, cleaned)

  if (!Value.Check(schema, withDefaults)) {
    const errors = [...Value.Errors(schema, withDefaults)]
      .map(error => `  - ${error.path || '/'}: ${error.message}`)
      .join('\n')
    throw new Error(`[elyvel] Invalid environment variables:\n${errors}`)
  }

  return withDefaults as Static<T>
}

export type { TSchema }
