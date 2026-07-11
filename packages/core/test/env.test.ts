import { describe, expect, test } from 'bun:test'
import { t } from 'elysia'
import { defineEnv } from '../src/env'

describe('defineEnv', () => {
  test('coerces string env values to the schema types', () => {
    const env = defineEnv(
      t.Object({
        PORT: t.Number(),
        DEBUG: t.Boolean(),
      }),
      { PORT: '8080', DEBUG: 'true' },
    )
    expect(env.PORT).toBe(8080)
    expect(env.DEBUG).toBe(true)
  })

  test('applies defaults for absent variables', () => {
    const env = defineEnv(
      t.Object({ PORT: t.Number({ default: 3000 }) }),
      {},
    )
    expect(env.PORT).toBe(3000)
  })

  test('accepts a valid union literal', () => {
    const env = defineEnv(
      t.Object({ APP_ENV: t.Union([t.Literal('local'), t.Literal('production')]) }),
      { APP_ENV: 'production' },
    )
    expect(env.APP_ENV).toBe('production')
  })

  test('throws with a readable message when required vars are missing', () => {
    expect(() =>
      defineEnv(t.Object({ SECRET: t.String() }), {}),
    ).toThrow(/Invalid environment variables/)
  })
})
