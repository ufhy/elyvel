/**
 * DB-backed rules (`unique`, `exists`) need a query. To keep this package
 * DB-agnostic, the app injects a resolver (wired to `@elyvel/database`).
 */
export interface DbRuleResolver {
  /** Count rows in `table` where `column` = `value` (optionally excluding an id). */
  count(table: string, column: string, value: unknown, ignoreId?: unknown): Promise<number>
}

/** Thrown when a `unique`/`exists` DB query doesn't resolve within the configured timeout. */
export class DbRuleTimeoutError extends Error {
  constructor(table: string, timeoutMs: number) {
    super(`[elyvel] unique/exists query on "${table}" timed out after ${timeoutMs}ms.`)
    this.name = 'DbRuleTimeoutError'
  }
}

let resolver: DbRuleResolver | null = null
// A hung connection pool / network partition otherwise leaves this `await`
// stuck forever (validator.ts awaits it unconditionally) — one bad request
// piling up under load with no self-recovery, no 5xx/408, nothing. Bound it.
let timeoutMs = 5000

/**
 * Wire the DB resolver used by `unique`/`exists` (call once at boot).
 * `timeoutMs` (default 5000) bounds how long a single count query may hang.
 */
export function configureDbRules(r: DbRuleResolver, options?: { timeoutMs?: number }): void {
  resolver = r
  if (options?.timeoutMs !== undefined)
    timeoutMs = options.timeoutMs
}

export function getDbResolver(): DbRuleResolver {
  if (!resolver) {
    throw new Error(
      '[elyvel] `unique`/`exists` need a DB resolver. Call configureDbRules(...) at boot.',
    )
  }
  return resolver
}

/** `getDbResolver().count(...)`, but rejects with {@link DbRuleTimeoutError} past the configured timeout. */
export async function countWithTimeout(
  table: string,
  column: string,
  value: unknown,
  ignoreId?: unknown,
): Promise<number> {
  const r = getDbResolver()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      r.count(table, column, value, ignoreId),
      new Promise<number>((_, reject) => {
        timer = setTimeout(() => reject(new DbRuleTimeoutError(table, timeoutMs)), timeoutMs)
        if (typeof timer === 'object' && timer && 'unref' in timer) {
          const unrefable = timer as unknown as { unref(): void }
          unrefable.unref()
        }
      }),
    ])
  }
  finally {
    clearTimeout(timer)
  }
}
