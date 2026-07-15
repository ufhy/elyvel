import { table } from '@elysia-ravel/database'
import type { CleanedWhere } from 'better-auth/adapters'
import { createAdapterFactory } from 'better-auth/adapters'

type QB = ReturnType<typeof table>
type Row = Record<string, any>

export interface EloquentAdapterOptions {
  usePlural?: boolean
  debugLogs?: boolean
}

/** Apply Better Auth's `where` clauses to our query builder (operators + AND/OR). */
function applyWhere(qb: QB, where?: CleanedWhere[]): QB {
  for (const w of where ?? []) {
    const or = w.connector === 'OR'
    const like = (pattern: string) =>
      or ? qb.orWhere(w.field, 'like', pattern) : qb.where(w.field, 'like', pattern)
    const cmp = (op: string) =>
      or ? qb.orWhere(w.field, op, w.value) : qb.where(w.field, op, w.value)
    switch (w.operator) {
      case 'ne':
        w.value === null ? qb.whereNotNull(w.field) : cmp('!=')
        break
      case 'lt':
        cmp('<')
        break
      case 'lte':
        cmp('<=')
        break
      case 'gt':
        cmp('>')
        break
      case 'gte':
        cmp('>=')
        break
      case 'in':
        qb.whereIn(w.field, w.value as unknown[])
        break
      case 'not_in':
        qb.whereNotIn(w.field, w.value as unknown[])
        break
      case 'contains':
        like(`%${String(w.value)}%`)
        break
      case 'starts_with':
        like(`${String(w.value)}%`)
        break
      case 'ends_with':
        like(`%${String(w.value)}`)
        break
      default: // 'eq'
        w.value === null ? qb.whereNull(w.field) : cmp('=')
    }
  }
  return qb
}

/**
 * A Better Auth database adapter backed by elysia-ravel's Eloquent query builder.
 * Every Better Auth DB operation runs through `table()` on the app's default
 * connection — no separate connection or ORM. Pass it as `database`:
 *
 *   betterAuth({ database: eloquentAdapter(), emailAndPassword: { enabled: true } })
 */
export function eloquentAdapter(options: EloquentAdapterOptions = {}) {
  return createAdapterFactory({
    config: {
      adapterId: 'eloquent',
      adapterName: 'Eloquent',
      usePlural: options.usePlural ?? false,
      debugLogs: options.debugLogs ?? false,
      // Let Better Auth normalize values (ISO date strings, 0/1 booleans, JSON
      // strings) so the raw query builder can store them portably on any dialect.
      supportsNumericIds: false,
      supportsJSON: false,
      supportsDates: false,
      supportsBooleans: false,
    },
    adapter: () => ({
      async create({ model, data }) {
        await table(model).insert(data as Row)
        return data as any
      },
      async findOne({ model, where }) {
        return ((await applyWhere(table(model), where).first()) ?? null) as any
      },
      async findMany({ model, where, limit, offset, sortBy }) {
        let qb = applyWhere(table(model), where)
        if (sortBy) qb = qb.orderBy(sortBy.field, sortBy.direction)
        if (typeof limit === 'number') qb = qb.limit(limit)
        if (typeof offset === 'number') qb = qb.offset(offset)
        return (await qb.get()) as any
      },
      async update({ model, where, update }) {
        await applyWhere(table(model), where).update(update as Row)
        return ((await applyWhere(table(model), where).first()) ?? null) as any
      },
      async updateMany({ model, where, update }) {
        const count = await applyWhere(table(model), where).count()
        await applyWhere(table(model), where).update(update as Row)
        return count
      },
      async delete({ model, where }) {
        await applyWhere(table(model), where).delete()
      },
      async deleteMany({ model, where }) {
        const count = await applyWhere(table(model), where).count()
        await applyWhere(table(model), where).delete()
        return count
      },
      async count({ model, where }) {
        return applyWhere(table(model), where).count()
      },
      // Emit an Eloquent migration for Better Auth's tables (used by `generate`).
      createSchema: async ({ file, tables }) => {
        return {
          code: buildMigration(tables),
          path: file ?? 'database/migrations/0000_better_auth.ts',
        }
      },
    }),
  })
}

/** Map a Better Auth field type to an elysia-ravel Blueprint column call. */
function columnFor(
  name: string,
  attr: { type?: unknown; required?: boolean; unique?: boolean },
): string {
  const type = String(attr.type ?? 'string')
  const base =
    type === 'boolean'
      ? `t.boolean(${JSON.stringify(name)})`
      : type === 'number'
        ? `t.integer(${JSON.stringify(name)})`
        : type === 'date'
          ? `t.timestamp(${JSON.stringify(name)})`
          : type.includes('[]')
            ? `t.text(${JSON.stringify(name)})`
            : `t.string(${JSON.stringify(name)})`
  const mods = `${attr.unique ? '.unique()' : ''}${attr.required === false ? '.nullable()' : ''}`
  return `${base}${mods}`
}

/** Build the migration file source from Better Auth's resolved schema tables. */
function buildMigration(tables: Record<string, { fields: Record<string, any> }>): string {
  const creates: string[] = []
  const drops: string[] = []
  for (const [tableName, def] of Object.entries(tables)) {
    const cols = ['      t.string("id").unique()']
    for (const [field, attr] of Object.entries(def.fields)) {
      cols.push(
        `      ${columnFor(field, attr as { type?: unknown; required?: boolean; unique?: boolean })}`,
      )
    }
    creates.push(
      `    schema.create(${JSON.stringify(tableName)}, (t) => {\n${cols.join('\n')}\n    })`,
    )
    drops.push(`    schema.dropIfExists(${JSON.stringify(tableName)})`)
  }
  return (
    `import type { Migration } from '@elysia-ravel/database'\n\n` +
    `export default {\n` +
    `  up: async (schema) => {\n${creates.map((c) => c.replace('    schema', '    await schema')).join('\n')}\n  },\n` +
    `  down: async (schema) => {\n${drops.map((d) => d.replace('    schema', '    await schema')).join('\n')}\n  },\n` +
    `} satisfies Migration\n`
  )
}
