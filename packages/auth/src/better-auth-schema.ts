import type { SchemaBuilder } from '@elyvel/database'
import type { BetterAuthOptions } from 'better-auth'
import { getSchema } from 'better-auth/db'

/**
 * Create Better Auth's tables (user/session/account/verification + any plugin
 * tables) using elyvel's schema builder — one connection, all in Eloquent.
 * Call it from a migration: `await migrateBetterAuth(schema, auth.options)`.
 * Returns the created table names.
 */
export async function migrateBetterAuth(
  schema: SchemaBuilder,
  options: BetterAuthOptions,
): Promise<string[]> {
  const tables = getSchema(options) as Record<string, { fields: Record<string, any> }>
  const created: string[] = []
  for (const [name, def] of Object.entries(tables)) {
    await schema.create(name, (t) => {
      t.string('id').unique()
      for (const [field, attr] of Object.entries(def.fields)) {
        if (field === 'id')
          continue
        const type = String(attr.type ?? 'string')
        const column
          = type === 'boolean'
            ? t.boolean(field)
            : type === 'number'
              ? t.integer(field)
              : type === 'date'
                ? t.timestamp(field)
                : type.includes('[]')
                  ? t.text(field)
                  : t.string(field)
        if (attr.unique)
          column.unique()
        if (attr.required === false)
          column.nullable()
      }
    })
    created.push(name)
  }
  return created
}
