import { eq, type InferInsertModel, type InferSelectModel, type SQL, type Table } from 'drizzle-orm'
import { useDatabase } from './connection'

type Row<T extends Table> = InferSelectModel<T>
type NewRow<T extends Table> = InferInsertModel<T>

/**
 * Wrap a Drizzle table in an Eloquent-flavored, fully-typed query API.
 *
 * All methods are async and dialect-agnostic: the same model works whether the
 * active connection is SQLite, Postgres, or PGlite. Return/argument types are
 * inferred straight from the table definition — no `any` in userland.
 *
 * @example
 * export const User = defineModel(users)
 * const all   = await User.all()                  // Row[]
 * const one   = await User.find(1)                // Row | undefined
 * const fresh = await User.create({ name: 'Al' }) // Row
 */
export function defineModel<TTable extends Table>(table: TTable) {
  // Convention: primary key is `id` (matches make:migration output).
  const idColumn = () => (table as unknown as { id: Parameters<typeof eq>[0] }).id

  return {
    table,

    /** Escape hatch: the raw Drizzle select builder for this table. */
    query() {
      return useDatabase().select().from(table)
    },

    /** All rows. */
    async all(): Promise<Row<TTable>[]> {
      return (await useDatabase().select().from(table)) as Row<TTable>[]
    },

    /** A single row by primary key, or `undefined`. */
    async find(id: number | string | bigint): Promise<Row<TTable> | undefined> {
      const rows = (await useDatabase()
        .select()
        .from(table)
        .where(eq(idColumn(), id))
        .limit(1)) as Row<TTable>[]
      return rows[0]
    },

    /** Rows matching a Drizzle condition, e.g. `where(eq(users.email, x))`. */
    async where(condition: SQL): Promise<Row<TTable>[]> {
      return (await useDatabase().select().from(table).where(condition)) as Row<TTable>[]
    },

    /** Insert one row and return it. */
    async create(values: NewRow<TTable>): Promise<Row<TTable>> {
      const rows = (await useDatabase().insert(table).values(values).returning()) as Row<TTable>[]
      return rows[0] as Row<TTable>
    },

    /** Total row count. */
    async count(): Promise<number> {
      const rows = (await useDatabase().select().from(table)) as unknown[]
      return rows.length
    },
  }
}

export type Model<TTable extends Table> = ReturnType<typeof defineModel<TTable>>
