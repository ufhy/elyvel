import type { Blueprint, SchemaBuilder } from '@elyvel/database'
import type { BetterAuthOptions } from 'better-auth'
import { hasColumn, hasTable } from '@elyvel/database'
import { getSchema } from 'better-auth/db'

/** A single Better Auth field attribute, as returned by `getSchema()`. */
interface FieldAttr {
  type?: string
  unique?: boolean
  required?: boolean
}

function addBetterAuthColumn(t: Blueprint, field: string, attr: FieldAttr): void {
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

/**
 * Create — or, on a re-run, incrementally update — Better Auth's tables
 * (user/session/account/verification + any plugin tables) using elyvel's
 * schema builder. Call it from a migration: `await migrateBetterAuth(schema, auth.options)`.
 *
 * Idempotent and incremental, so it's safe to call again from a NEW migration
 * after enabling a plugin that adds fields/tables (e.g. `username()` adds a
 * `users.username` column; `twoFactor()` adds its own `twoFactor` table):
 * a table that already exists is left alone except for any columns it's
 * MISSING (added via `schema.table()`); a table that doesn't exist yet is
 * created in full. Returns the names of every table actually touched
 * (created or altered) — empty if nothing changed.
 */
export async function migrateBetterAuth(
  schema: SchemaBuilder,
  options: BetterAuthOptions,
): Promise<string[]> {
  const tables = getSchema(options) as Record<string, { fields: Record<string, FieldAttr> }>
  const touched: string[] = []
  for (const [name, def] of Object.entries(tables)) {
    if (!(await hasTable(schema.connection, name))) {
      await schema.create(name, (t) => {
        t.string('id').unique()
        for (const [field, attr] of Object.entries(def.fields)) {
          if (field !== 'id')
            addBetterAuthColumn(t, field, attr)
        }
      })
      touched.push(name)
      continue
    }

    const missing: [string, FieldAttr][] = []
    for (const [field, attr] of Object.entries(def.fields)) {
      if (field !== 'id' && !(await hasColumn(schema.connection, name, field)))
        missing.push([field, attr])
    }
    if (missing.length > 0) {
      await schema.table(name, (t) => {
        for (const [field, attr] of missing) addBetterAuthColumn(t, field, attr)
      })
      touched.push(name)
    }
  }
  return touched
}
