/**
 * DB-backed rules (`unique`, `exists`) need a query. To keep this package
 * DB-agnostic, the app injects a resolver (wired to `@elysia-ravel/database`).
 */
export interface DbRuleResolver {
  /** Count rows in `table` where `column` = `value` (optionally excluding an id). */
  count(table: string, column: string, value: unknown, ignoreId?: unknown): Promise<number>
}

let resolver: DbRuleResolver | null = null

/** Wire the DB resolver used by `unique`/`exists` (call once at boot). */
export function configureDbRules(r: DbRuleResolver): void {
  resolver = r
}

export function getDbResolver(): DbRuleResolver {
  if (!resolver) {
    throw new Error(
      '[elysia-ravel] `unique`/`exists` need a DB resolver. Call configureDbRules(...) at boot.',
    )
  }
  return resolver
}
