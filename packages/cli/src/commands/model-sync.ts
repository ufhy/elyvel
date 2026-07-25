import type { Cast, ColumnInfo, Model } from '@elyvel/database'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tableColumns } from '@elyvel/database'
import { boot } from './db'

/** The static config `resolveType`/`planModelSync` need — a plain object so it's testable without a real Model subclass. */
export interface ModelMeta {
  primaryKey: string
  createdAtColumn: string
  updatedAtColumn: string
  deletedAtColumn: string
  casts: Record<string, Cast>
}

/** The TS type a cast produces when read (mirrors `castGet` in `@elyvel/database`). */
export function castToType(cast: Cast): string {
  if (typeof cast === 'object')
    return 'unknown'
  switch (cast) {
    case 'int':
    case 'integer':
    case 'float':
    case 'double':
      return 'number'
    case 'boolean':
    case 'bool':
      return 'boolean'
    case 'string':
      return 'string'
    case 'json':
    case 'array':
      return 'Record<string, unknown>'
    case 'date':
    case 'datetime':
      return 'Dayjs'
    case 'encrypted':
      return 'unknown'
  }
}

/**
 * Best-effort guess from the raw DB column type — only reached when there's no
 * cast to go by. elyvel's own migrations store json/date/datetime as TEXT/VARCHAR
 * (see grammar.ts), so this can't reliably detect those; it only recognizes
 * genuinely typed columns (numbers, native booleans, native json).
 */
export function inferFromDbType(rawType: string, dialect: string): string {
  const t = rawType.toLowerCase()
  if (dialect === 'mysql') {
    if (/^tinyint\(1\)/.test(t))
      return 'boolean'
    if (/^(?:tinyint|smallint|mediumint|int|bigint|decimal|float|double)/.test(t))
      return 'number'
    if (t === 'json')
      return 'Record<string, unknown>'
    return 'string'
  }
  if (dialect === 'pg') {
    if (t === 'boolean')
      return 'boolean'
    if (/^(?:smallint|integer|bigint|numeric|real|double precision|serial|bigserial)/.test(t))
      return 'number'
    if (t === 'json' || t === 'jsonb')
      return 'Record<string, unknown>'
    return 'string'
  }
  // sqlite: booleans/timestamps share the same affinity as plain numbers/text.
  if (t === 'integer' || t === 'real' || t === 'numeric')
    return 'number'
  return 'string'
}

export function resolveType(column: ColumnInfo, meta: ModelMeta, dialect: string): string {
  // created_at/updated_at are DB-nullable (see schema.ts) but `save()` always
  // populates them before a row is ever read back — declare them non-null to
  // match the hand-written convention elsewhere. deleted_at stays nullable:
  // that one is null for most of a row's life.
  if (column.name === meta.createdAtColumn || column.name === meta.updatedAtColumn)
    return 'Dayjs'
  if (column.name === meta.deletedAtColumn)
    return 'Dayjs | null'

  const cast = meta.casts[column.name]
  const base = cast ? castToType(cast) : inferFromDbType(column.type, dialect)
  // SQLite reports an INTEGER PRIMARY KEY column as nullable in its own catalog
  // (a rowid-alias quirk) even though it can never actually be null.
  const nullable = column.name === meta.primaryKey ? false : column.nullable
  return nullable ? `${base} | null` : base
}

export interface ModelSyncPlan {
  /** Columns missing a `declare` line, with the line to add for each. */
  missing: ColumnInfo[]
  lines: string[]
  /** `declare`d fields with no matching DB column (possible drift/typo) — reported, never removed. */
  stale: string[]
}

/** Diff a model's real (non-commented) `declare` lines against its table's columns. Pure — no I/O. */
export function planModelSync(source: string, columns: ColumnInfo[], meta: ModelMeta, dialect: string): ModelSyncPlan {
  // Only real `declare` lines — a commented-out example (`//   declare foo: Bar`)
  // must not count as either "already declared" or a stale field.
  const declared = new Set(
    source.split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('declare '))
      .map(line => /^declare\s+(\w+)/.exec(line)?.[1])
      .filter((name): name is string => Boolean(name)),
  )

  const stale = [...declared].filter(field => !columns.some(c => c.name === field))
  const missing = columns.filter(c => !declared.has(c.name))
  const lines = missing.map(c => `  declare ${c.name}: ${resolveType(c, meta, dialect)}`)

  return { missing, lines, stale }
}

/**
 * Add the given `declare` lines to a model's source (after the last existing
 * `declare` line, or the last `static` line, or right inside the class body),
 * activating/adding the `Dayjs` import if any line needs it. Pure — no I/O.
 */
export function applyModelSync(source: string, lines: string[]): string | null {
  const rows = source.split('\n')
  const lastDeclareIdx = rows.reduce((last, line, i) => (/^\s*declare\s+\w+/.test(line) ? i : last), -1)
  const lastStaticIdx = rows.reduce((last, line, i) => (/^\s*static\s/.test(line) ? i : last), -1)
  const insertAt = lastDeclareIdx >= 0
    ? lastDeclareIdx + 1
    : lastStaticIdx >= 0
      ? lastStaticIdx + 1
      : rows.findIndex(l => /extends Model\s*\{/.test(l)) + 1

  if (insertAt <= 0)
    return null

  rows.splice(insertAt, 0, ...lines)

  // A generated `Dayjs` type needs the (often commented-out, stub-default) import active.
  if (lines.some(l => l.includes('Dayjs'))) {
    const hasLiveImport = rows.some(l => /^\s*import\s+type\s*\{[^}]*\bDayjs\b[^}]*\}\s*from\s*['"]@elyvel\/database['"]/.test(l))
    if (!hasLiveImport) {
      const commentedIdx = rows.findIndex(l => /^\s*\/\/\s*import\s+type\s*\{[^}]*\bDayjs\b[^}]*\}\s*from\s*['"]@elyvel\/database['"]/.test(l))
      if (commentedIdx >= 0) {
        rows[commentedIdx] = rows[commentedIdx]!.replace(/^(\s*)\/\/\s*/, '$1')
      }
      else {
        const lastImportIdx = rows.reduce((last, l, i) => (/^import\s/.test(l) ? i : last), -1)
        rows.splice(lastImportIdx + 1, 0, 'import type { Dayjs } from \'@elyvel/database\'')
      }
    }
  }

  return rows.join('\n')
}

/**
 * `elyvel model:sync <Name> [--write]` — introspect the model's table and report
 * (or, with `--write`, add) `declare` field lines for columns it doesn't yet
 * declare. Additive only: never touches `fillable`/`guarded` (mass-assignment is
 * a security boundary, not derivable from schema) or `casts` (runtime behavior),
 * and never removes/reorders an existing `declare` line — a mismatch is only
 * reported, so a computed/accessor-backed `declare` never gets clobbered.
 */
export async function modelSyncCommand(
  name?: string,
  flags: Record<string, string | boolean> = {},
): Promise<number> {
  if (!name) {
    console.error('Usage: elyvel model:sync <Name> [--write]')
    return 1
  }

  const { app, conn } = await boot()
  const file = app.path(`app/models/${name}.ts`)
  if (!existsSync(file)) {
    console.error(`No model found at app/models/${name}.ts`)
    return 1
  }

  const module = (await import(file)) as { default?: typeof Model }
  const cls = module.default
  if (!cls) {
    console.error(`${name}.ts must default-export a Model class.`)
    return 1
  }

  const table = cls.getTableName()
  const columns = await tableColumns(conn, table)
  const source = readFileSync(file, 'utf8')
  const meta: ModelMeta = {
    primaryKey: cls.primaryKey,
    createdAtColumn: cls.createdAtColumn,
    updatedAtColumn: cls.updatedAtColumn,
    deletedAtColumn: cls.deletedAtColumn,
    casts: cls.casts,
  }
  const { missing, lines, stale } = planModelSync(source, columns, meta, conn.dialect)

  if (stale.length > 0)
    console.log(`⚠ declared in ${name}.ts but not in "${table}": ${stale.join(', ')}`)

  if (missing.length === 0) {
    console.log(`✓ ${name} is already in sync with "${table}".`)
    return 0
  }

  if (!flags.write) {
    console.log(`Missing from ${name} (table "${table}"):\n${lines.join('\n')}\n\nRun with --write to add them.`)
    return 0
  }

  const updated = applyModelSync(source, lines)
  if (updated === null) {
    console.error(`Could not locate the class body in ${name}.ts — add manually:\n${lines.join('\n')}`)
    return 1
  }

  writeFileSync(file, updated)
  console.log(`✓ Added ${missing.length} field${missing.length === 1 ? '' : 's'} to ${name}.ts:\n${lines.join('\n')}`)
  return 0
}
