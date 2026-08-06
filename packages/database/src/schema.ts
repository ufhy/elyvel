import type { Connection } from './connection'
import type {
  ColumnDefinition,
  ColumnType,
  ForeignKeyDefinition,
  IndexDefinition,
  PrimaryKeyDefinition,
  RefAction,
} from './grammar'
import { Str } from '@elyvel/support'
import { foreignKeyConstraintName } from './inspect'

/** Fluent modifiers returned by each column method. */
class ColumnBuilder {
  constructor(private readonly def: ColumnDefinition) {}
  nullable(): this {
    this.def.nullable = true
    return this
  }

  unique(): this {
    this.def.unique = true
    return this
  }

  default(value: unknown): this {
    this.def.default = value
    return this
  }

  /** `UNSIGNED` on MariaDB/MySQL (ignored elsewhere, like Laravel). */
  unsigned(): this {
    this.def.unsigned = true
    return this
  }

  /** Column comment (MariaDB/MySQL/PostgreSQL — ignored on SQLite). */
  comment(text: string): this {
    this.def.comment = text
    return this
  }

  /**
   * A generated column, physically computed from `expr` and stored on disk
   * (MySQL, Postgres, SQLite 3.31+). The column can't be assigned to directly.
   */
  storedAs(expr: string): this {
    this.def.generatedAs = { expr, stored: true }
    return this
  }

  /**
   * A generated column, computed on read rather than stored (MySQL, SQLite
   * 3.31+). Not supported on Postgres — it only has STORED generated columns;
   * use {@link storedAs} there.
   */
  virtualAs(expr: string): this {
    this.def.generatedAs = { expr, stored: false }
    return this
  }

  /**
   * `DEFAULT CURRENT_TIMESTAMP`. Use with `timestampTz()`/`dateTimeTz()` on
   * MySQL — plain `timestamp()`/`datetime()` stay `TEXT` there for
   * cross-dialect ISO-string consistency, and MySQL rejects a
   * `CURRENT_TIMESTAMP` default on a `TEXT` column.
   */
  useCurrent(): this {
    this.def.useCurrent = true
    return this
  }

  /** `ON UPDATE CURRENT_TIMESTAMP` (MariaDB/MySQL only). */
  useCurrentOnUpdate(): this {
    this.def.useCurrentOnUpdate = true
    return this
  }

  /** `foreignId('user_id').constrained('users')` → FK to users(id). */
  constrained(table: string, column = 'id'): this {
    this.def.references = { table, column }
    return this
  }

  onDelete(action: RefAction): this {
    if (this.def.references)
      this.def.references.onDelete = action
    return this
  }

  onUpdate(action: RefAction): this {
    if (this.def.references)
      this.def.references.onUpdate = action
    return this
  }

  cascadeOnDelete(): this {
    return this.onDelete('cascade')
  }

  restrictOnDelete(): this {
    return this.onDelete('restrict')
  }

  nullOnDelete(): this {
    return this.onDelete('set null')
  }

  noActionOnDelete(): this {
    return this.onDelete('no action')
  }

  cascadeOnUpdate(): this {
    return this.onUpdate('cascade')
  }

  restrictOnUpdate(): this {
    return this.onUpdate('restrict')
  }

  nullOnUpdate(): this {
    return this.onUpdate('set null')
  }

  noActionOnUpdate(): this {
    return this.onUpdate('no action')
  }

  /** Mark this column as a modification of an existing one (Postgres only). */
  change(): this {
    this.def.change = true
    return this
  }
}

/** `foreign('user_id').references('id').on('users')` — a standalone FK constraint. */
class ForeignKeyBuilder {
  constructor(private readonly def: ForeignKeyDefinition) {}
  references(column: string): this {
    this.def.references = { table: this.def.references?.table ?? '', column }
    return this
  }

  on(table: string): this {
    if (this.def.references)
      this.def.references.table = table
    else
      this.def.references = { table, column: 'id' }
    return this
  }

  name(name: string): this {
    this.def.name = name
    return this
  }

  onDelete(action: RefAction): this {
    this.def.onDelete = action
    return this
  }

  onUpdate(action: RefAction): this {
    this.def.onUpdate = action
    return this
  }

  cascadeOnDelete(): this {
    return this.onDelete('cascade')
  }

  restrictOnDelete(): this {
    return this.onDelete('restrict')
  }

  nullOnDelete(): this {
    return this.onDelete('set null')
  }

  noActionOnDelete(): this {
    return this.onDelete('no action')
  }

  cascadeOnUpdate(): this {
    return this.onUpdate('cascade')
  }

  restrictOnUpdate(): this {
    return this.onUpdate('restrict')
  }

  nullOnUpdate(): this {
    return this.onUpdate('set null')
  }

  noActionOnUpdate(): this {
    return this.onUpdate('no action')
  }
}

/**
 * Collects a table's columns dialect-neutrally (Laravel's `Blueprint`). The
 * grammar turns these into dialect-correct DDL.
 */
export class Blueprint {
  /**
   * The table being built. Only used to name indexes: index names are
   * database-global on SQLite and Postgres, so an unprefixed default like
   * `name_guard_unique` makes the SECOND table declaring the same columns fail
   * to create. Laravel prefixes for exactly this reason, and so do we.
   */
  constructor(private readonly tableName = '') {}

  /** `users_email_unique` — Laravel's `{table}_{columns}_{type}` convention. */
  private indexName(columns: string[], type: string): string {
    return [this.tableName, ...columns, type].filter(Boolean).join('_')
  }

  readonly columns: ColumnDefinition[] = []
  readonly indexes: IndexDefinition[] = []
  readonly dropColumns: string[] = []
  readonly renameColumns: { from: string, to: string }[] = []
  readonly dropIndexes: string[] = []
  readonly dropForeigns: string[] = []
  readonly primaryKeys: PrimaryKeyDefinition[] = []
  readonly dropPrimaries: (string | undefined)[] = []
  readonly foreignKeys: ForeignKeyDefinition[] = []
  readonly renameIndexes: { from: string, to: string }[] = []
  /** Set by `dropUserstamps()` — those columns carry FK constraints, which SQLite can't drop via `ALTER TABLE`. */
  droppedUserstamps = false
  /** Set by `temporary()` — a session-local table, dropped automatically when the connection closes. */
  isTemporary = false
  /** Set by `engine()` — MySQL/MariaDB only (`ENGINE=InnoDB`); ignored on Postgres/SQLite. */
  tableEngine?: string
  /** Set by `charset()` — MySQL/MariaDB only (`DEFAULT CHARSET=...`); ignored on Postgres/SQLite. */
  tableCharset?: string
  /** Set by `collation()` — MySQL/MariaDB only (`COLLATE=...`); ignored on Postgres/SQLite. */
  tableCollation?: string

  /** A session-local table (`CREATE TEMPORARY TABLE`) — dropped automatically when the connection closes. */
  temporary(): void {
    this.isTemporary = true
  }

  /** MySQL/MariaDB storage engine (e.g. `'InnoDB'`, `'MyISAM'`). No table-level equivalent on Postgres/SQLite — ignored there. */
  engine(name: string): void {
    this.tableEngine = name
  }

  /** MySQL/MariaDB table default charset (e.g. `'utf8mb4'`). No table-level equivalent on Postgres/SQLite — ignored there. */
  charset(name: string): void {
    this.tableCharset = name
  }

  /** MySQL/MariaDB table collation (e.g. `'utf8mb4_unicode_ci'`). No table-level equivalent on Postgres/SQLite — ignored there. */
  collation(name: string): void {
    this.tableCollation = name
  }

  private push(def: ColumnDefinition): ColumnBuilder {
    this.columns.push(def)
    return new ColumnBuilder(def)
  }

  id(name = 'id'): ColumnBuilder {
    return this.push({ name, type: 'id' })
  }

  string(name: string, length = 255): ColumnBuilder {
    return this.push({ name, type: 'string', length })
  }

  text(name: string): ColumnBuilder {
    return this.push({ name, type: 'text' })
  }

  char(name: string, length = 255): ColumnBuilder {
    return this.push({ name, type: 'char', length })
  }

  mediumText(name: string): ColumnBuilder {
    return this.push({ name, type: 'mediumText' })
  }

  longText(name: string): ColumnBuilder {
    return this.push({ name, type: 'longText' })
  }

  tinyInteger(name: string): ColumnBuilder {
    return this.push({ name, type: 'tinyInteger' })
  }

  smallInteger(name: string): ColumnBuilder {
    return this.push({ name, type: 'smallInteger' })
  }

  mediumInteger(name: string): ColumnBuilder {
    return this.push({ name, type: 'mediumInteger' })
  }

  integer(name: string): ColumnBuilder {
    return this.push({ name, type: 'integer' })
  }

  bigInteger(name: string): ColumnBuilder {
    return this.push({ name, type: 'bigInteger' })
  }

  /** `UNSIGNED TINYINT` (MariaDB/MySQL — plain `TINYINT` elsewhere). */
  unsignedTinyInteger(name: string): ColumnBuilder {
    return this.tinyInteger(name).unsigned()
  }

  /** `UNSIGNED SMALLINT` (MariaDB/MySQL — plain `SMALLINT` elsewhere). */
  unsignedSmallInteger(name: string): ColumnBuilder {
    return this.smallInteger(name).unsigned()
  }

  /** `UNSIGNED MEDIUMINT` (MariaDB/MySQL — plain `MEDIUMINT`/`INTEGER` elsewhere). */
  unsignedMediumInteger(name: string): ColumnBuilder {
    return this.mediumInteger(name).unsigned()
  }

  /** `UNSIGNED INT` (MariaDB/MySQL — plain `INTEGER` elsewhere). */
  unsignedInteger(name: string): ColumnBuilder {
    return this.integer(name).unsigned()
  }

  /** `UNSIGNED BIGINT` (MariaDB/MySQL — plain `BIGINT` elsewhere). */
  unsignedBigInteger(name: string): ColumnBuilder {
    return this.bigInteger(name).unsigned()
  }

  float(name: string): ColumnBuilder {
    return this.push({ name, type: 'float' })
  }

  double(name: string): ColumnBuilder {
    return this.push({ name, type: 'double' })
  }

  boolean(name: string): ColumnBuilder {
    return this.push({ name, type: 'boolean' })
  }

  timestamp(name: string): ColumnBuilder {
    return this.push({ name, type: 'timestamp' })
  }

  /** Timezone-aware timestamp (native `TIMESTAMPTZ` on Postgres). */
  timestampTz(name: string): ColumnBuilder {
    return this.push({ name, type: 'timestampTz' })
  }

  time(name: string): ColumnBuilder {
    return this.push({ name, type: 'time' })
  }

  /** Timezone-aware time (native `TIMETZ` on Postgres). */
  timeTz(name: string): ColumnBuilder {
    return this.push({ name, type: 'timeTz' })
  }

  /** Timezone-aware `DATETIME` (native `TIMESTAMPTZ` on Postgres). */
  dateTimeTz(name: string): ColumnBuilder {
    return this.push({ name, type: 'dateTimeTz' })
  }

  /** `YEAR` (MariaDB/MySQL — plain integer elsewhere). */
  year(name: string): ColumnBuilder {
    return this.push({ name, type: 'year' })
  }

  tinyText(name: string): ColumnBuilder {
    return this.push({ name, type: 'tinyText' })
  }

  /** `INET` on Postgres, `VARCHAR` elsewhere — the cross-dialect convenience (see also `inet()`). */
  ipAddress(name: string): ColumnBuilder {
    return this.push({ name, type: 'ipAddress' })
  }

  /** `MACADDR` on Postgres, `VARCHAR` elsewhere — the cross-dialect convenience (see also `macaddr()`). */
  macAddress(name: string): ColumnBuilder {
    return this.push({ name, type: 'macAddress' })
  }

  /** Nullable `VARCHAR(100)` intended for a "remember me" token. */
  rememberToken(): ColumnBuilder {
    return this.string('remember_token', 100).nullable()
  }

  json(name: string): ColumnBuilder {
    return this.push({ name, type: 'json' })
  }

  /** Native JSONB on Postgres (indexable / queryable). */
  jsonb(name: string): ColumnBuilder {
    return this.push({ name, type: 'jsonb' })
  }

  /**
   * A spatial column — PostGIS `GEOMETRY` on Postgres, native `GEOMETRY`/`POINT`/…
   * on MySQL. Pass a `subtype` to narrow it and an `srid` to pin the coordinate
   * system:
   *
   * ```ts
   * t.geometry('area')                        // any geometry
   * t.geometry('location', 'point')           // GEOMETRY(Point) / POINT
   * t.geometry('location', 'point', 4326)     // …with an SRID
   * ```
   *
   * Postgres needs the PostGIS extension enabled. SQLite has no spatial support:
   * the column is created (SQLite accepts any declared type) so a schema stays
   * portable for dev/test, but spatial FUNCTIONS won't work there.
   */
  geometry(name: string, subtype?: string, srid?: number): ColumnBuilder {
    return this.push({ name, type: 'geometry', subtype, srid })
  }

  /**
   * PostGIS `GEOGRAPHY` — like {@link geometry} but with spherical (lat/long)
   * math. MySQL has no separate geography type, so it falls back to a spatial
   * column there.
   */
  geography(name: string, subtype?: string, srid?: number): ColumnBuilder {
    return this.push({ name, type: 'geography', subtype, srid })
  }

  /**
   * A fixed-width embedding vector — `VECTOR(n)` via pgvector on Postgres, native
   * `VECTOR(n)` on MySQL 9+. The dimension count is required by both.
   *
   * ```ts
   * t.vector('embedding', 1536)
   * ```
   */
  vector(name: string, dimensions: number): ColumnBuilder {
    return this.push({ name, type: 'vector', dimensions })
  }

  /** Binary blob — `BYTEA` on Postgres, `BLOB` on SQLite (e.g. raw bytes). */
  binary(name: string): ColumnBuilder {
    return this.push({ name, type: 'binary' })
  }

  /** Enum stored as a checked string (`CHECK (col IN (...))`). */
  enum(name: string, values: string[]): ColumnBuilder {
    return this.push({ name, type: 'enum', enumValues: values })
  }

  inet(name: string): ColumnBuilder {
    return this.push({ name, type: 'inet' })
  }

  cidr(name: string): ColumnBuilder {
    return this.push({ name, type: 'cidr' })
  }

  macaddr(name: string): ColumnBuilder {
    return this.push({ name, type: 'macaddr' })
  }

  interval(name: string): ColumnBuilder {
    return this.push({ name, type: 'interval' })
  }

  /** Postgres array column, e.g. `array('tags', 'text')` → `TEXT[]` (TEXT/JSON on SQLite). */
  array(name: string, of: ColumnType = 'text'): ColumnBuilder {
    return this.push({ name, type: 'array', arrayOf: of })
  }

  /**
   * `UNSIGNED BIGINT` (MariaDB/MySQL — plain `BIGINT` elsewhere), matching
   * `id()`'s type exactly so `constrained()` FKs type-check on MySQL, which
   * rejects a foreign key between mismatched signedness.
   */
  foreignId(name: string): ColumnBuilder {
    return this.bigInteger(name).unsigned()
  }

  uuid(name: string): ColumnBuilder {
    return this.push({ name, type: 'uuid' })
  }

  /** `CHAR(26)` ULID column (no dedicated DB type — stored as a fixed-length string). */
  ulid(name = 'id'): ColumnBuilder {
    return this.char(name, 26)
  }

  /** `UNSIGNED BIGINT`-equivalent FK column meant for a UUID-keyed parent. */
  foreignUuid(name: string): ColumnBuilder {
    return this.uuid(name)
  }

  /** FK column meant for a ULID-keyed parent. */
  foreignUlid(name: string): ColumnBuilder {
    return this.char(name, 26)
  }

  /**
   * `foreignIdFor('User')` → a `user_id` bigInteger column (name derived by
   * convention, TS has no `Model::class` to reflect on like Laravel's PHP).
   */
  foreignIdFor(modelName: string, columnName?: string): ColumnBuilder {
    return this.foreignId(columnName ?? `${Str.snake(modelName)}_id`)
  }

  decimal(name: string, precision = 10, scale = 2): ColumnBuilder {
    return this.push({ name, type: 'decimal', precision, scale })
  }

  date(name: string): ColumnBuilder {
    return this.push({ name, type: 'date' })
  }

  dateTime(name: string): ColumnBuilder {
    return this.push({ name, type: 'datetime' })
  }

  /** Polymorphic columns: `<name>_id` + `<name>_type`. */
  morphs(name: string): void {
    this.push({ name: `${name}_id`, type: 'bigInteger' })
    this.push({ name: `${name}_type`, type: 'string' })
  }

  /** Like {@link morphs}, but both columns are nullable. */
  nullableMorphs(name: string): void {
    this.push({ name: `${name}_id`, type: 'bigInteger', nullable: true })
    this.push({ name: `${name}_type`, type: 'string', nullable: true })
  }

  /** Polymorphic columns for a UUID-keyed parent: `<name>_id` (uuid) + `<name>_type`. */
  uuidMorphs(name: string): void {
    this.push({ name: `${name}_id`, type: 'uuid' })
    this.push({ name: `${name}_type`, type: 'string' })
  }

  /** Like {@link uuidMorphs}, but both columns are nullable. */
  nullableUuidMorphs(name: string): void {
    this.push({ name: `${name}_id`, type: 'uuid', nullable: true })
    this.push({ name: `${name}_type`, type: 'string', nullable: true })
  }

  /** Polymorphic columns for a ULID-keyed parent: `<name>_id` (char(26)) + `<name>_type`. */
  ulidMorphs(name: string): void {
    this.push({ name: `${name}_id`, type: 'char', length: 26 })
    this.push({ name: `${name}_type`, type: 'string' })
  }

  /** Like {@link ulidMorphs}, but both columns are nullable. */
  nullableUlidMorphs(name: string): void {
    this.push({ name: `${name}_id`, type: 'char', length: 26, nullable: true })
    this.push({ name: `${name}_type`, type: 'string', nullable: true })
  }

  /** A standalone (optionally composite) index. */
  index(columns: string | string[], name?: string): void {
    const cols = Array.isArray(columns) ? columns : [columns]
    this.indexes.push({ columns: cols, unique: false, name: name ?? this.indexName(cols, 'index') })
  }

  /** A standalone (optionally composite) unique index. */
  unique(columns: string | string[], name?: string): void {
    const cols = Array.isArray(columns) ? columns : [columns]
    this.indexes.push({ columns: cols, unique: true, name: name ?? this.indexName(cols, 'unique') })
  }

  /**
   * A full-text index (MySQL `FULLTEXT INDEX`; Postgres: a functional GIN
   * index over `to_tsvector(...)`, matching what {@link whereFullText}
   * queries against). No SQLite equivalent — `whereFullText()` still works
   * there via a `LIKE` fallback, it just has no index to speed it up.
   */
  fullText(columns: string | string[], name?: string): void {
    const cols = Array.isArray(columns) ? columns : [columns]
    this.indexes.push({ columns: cols, unique: false, name: name ?? this.indexName(cols, 'fulltext'), fullText: true })
  }

  /**
   * A spatial index (MySQL `SPATIAL INDEX`). Not supported on SQLite, and
   * needs the PostGIS extension on Postgres (not assumed installed here).
   */
  spatialIndex(columns: string | string[], name?: string): void {
    const cols = Array.isArray(columns) ? columns : [columns]
    this.indexes.push({ columns: cols, unique: false, name: name ?? this.indexName(cols, 'spatial'), spatial: true })
  }

  /** A single or composite primary key. */
  primary(columns: string | string[], name?: string): void {
    const cols = Array.isArray(columns) ? columns : [columns]
    this.primaryKeys.push({ columns: cols, name })
  }

  /** `foreign('user_id').references('id').on('users')` — a standalone FK on existing columns. */
  foreign(columns: string | string[]): ForeignKeyBuilder {
    const def: ForeignKeyDefinition = { columns: Array.isArray(columns) ? columns : [columns] }
    this.foreignKeys.push(def)
    return new ForeignKeyBuilder(def)
  }

  /** Drop one or more columns. */
  dropColumn(...names: string[]): void {
    this.dropColumns.push(...names)
  }

  /** Rename a column. */
  renameColumn(from: string, to: string): void {
    this.renameColumns.push({ from, to })
  }

  /** Drop an index by name. */
  dropIndex(name: string): void {
    this.dropIndexes.push(name)
  }

  /** Drop a unique index by name (same mechanism as `dropIndex`). */
  dropUnique(name: string): void {
    this.dropIndexes.push(name)
  }

  /** Drop the table's primary key (or a named one on Postgres). */
  dropPrimary(name?: string): void {
    this.dropPrimaries.push(name)
  }

  /** Rename an index (not supported on SQLite — drop and recreate instead). */
  renameIndex(from: string, to: string): void {
    this.renameIndexes.push({ from, to })
  }

  /** Drop a foreign-key constraint by name (Postgres only). */
  dropForeign(name: string): void {
    this.dropForeigns.push(name)
  }

  /** `created_at` + `updated_at` (nullable timestamps managed by the model). */
  timestamps(): void {
    this.push({ name: 'created_at', type: 'timestamp', nullable: true })
    this.push({ name: 'updated_at', type: 'timestamp', nullable: true })
  }

  /** Timezone-aware `timestamps()` (native `TIMESTAMPTZ` on Postgres). */
  timestampsTz(): void {
    this.push({ name: 'created_at', type: 'timestampTz', nullable: true })
    this.push({ name: 'updated_at', type: 'timestampTz', nullable: true })
  }

  /** Drop `created_at` + `updated_at`. */
  dropTimestamps(): void {
    this.dropColumn('created_at', 'updated_at')
  }

  /** Alias of {@link dropTimestamps}. */
  dropTimestampsTz(): void {
    this.dropTimestamps()
  }

  /** `deleted_at` nullable timestamp for soft deletes. */
  softDeletes(name = 'deleted_at'): ColumnBuilder {
    return this.push({ name, type: 'timestamp', nullable: true })
  }

  /** Timezone-aware `softDeletes()` (native `TIMESTAMPTZ` on Postgres). */
  softDeletesTz(name = 'deleted_at'): ColumnBuilder {
    return this.push({ name, type: 'timestampTz', nullable: true })
  }

  /** Drop the soft-delete column. */
  dropSoftDeletes(name = 'deleted_at'): void {
    this.dropColumn(name)
  }

  /** Alias of {@link dropSoftDeletes}. */
  dropSoftDeletesTz(name = 'deleted_at'): void {
    this.dropSoftDeletes(name)
  }

  /**
   * `created_by`/`updated_by`/`deleted_by` — nullable string FKs to `usersTable`
   * (Better Auth's `users.id` is a string, not an auto-increment integer),
   * `nullOnDelete()` so removing the referenced user doesn't cascade-delete
   * this row. Pairs with `Model.userstamps = true`, which auto-populates them
   * from whoever's making the current request.
   */
  userstamps(usersTable = 'users'): void {
    for (const column of ['created_by', 'updated_by', 'deleted_by']) {
      this.push({ name: column, type: 'string' })
        .nullable()
        .constrained(usersTable, 'id')
        .nullOnDelete()
    }
  }

  /**
   * Drop `created_by`/`updated_by`/`deleted_by`. Not supported on SQLite —
   * these columns carry a FK constraint, and SQLite's `ALTER TABLE DROP
   * COLUMN` refuses to drop a column referenced by one (rebuild the table
   * instead), the same restriction as `dropForeign()`/`.change()`.
   */
  dropUserstamps(): void {
    this.dropColumn('created_by', 'updated_by', 'deleted_by')
    this.droppedUserstamps = true
  }

  /** Drop the `<name>_type` + `<name>_id` columns created by `morphs()` (and its variants). */
  dropMorphs(name: string): void {
    this.dropColumn(`${name}_type`, `${name}_id`)
  }

  /** Drop the `remember_token` column. */
  dropRememberToken(): void {
    this.dropColumn('remember_token')
  }
}

/** Dialect-agnostic schema builder used inside migrations. */
/**
 * Collects SQL into `sink` instead of running it — used for `migrate --pretend`
 * so a dry run can show exactly what would execute with no side effects.
 */
export interface SchemaBuilderOptions {
  dryRun?: string[]
}

export class SchemaBuilder {
  private readonly dryRun?: string[]
  /** The underlying connection — public so callers can also run raw introspection (`hasTable`/`hasColumn`/...) alongside migrations. */
  constructor(readonly connection: Connection, options: SchemaBuilderOptions = {}) {
    this.dryRun = options.dryRun
  }

  private async run(sql: string): Promise<void> {
    if (this.dryRun) {
      this.dryRun.push(sql)
      return
    }
    await this.connection.statement(sql)
  }

  async create(table: string, build: (table: Blueprint) => void): Promise<void> {
    const blueprint = new Blueprint(table)
    build(blueprint)
    const g = this.connection.grammar
    const run = (sql: string) => this.run(sql)
    await run(g.compileCreateTable(table, blueprint.columns, blueprint.primaryKeys, {
      temporary: blueprint.isTemporary,
      engine: blueprint.tableEngine,
      charset: blueprint.tableCharset,
      collation: blueprint.tableCollation,
    }))
    for (const index of blueprint.indexes) {
      await run(g.compileCreateIndex(table, index))
    }
    for (const column of blueprint.columns) {
      if (column.comment === undefined)
        continue
      const stmt = g.compileColumnComment(table, column.name, column.comment)
      if (stmt)
        await run(stmt)
    }
  }

  /**
   * Alter a table: add / change / rename / drop columns, add / drop indexes,
   * primary keys, and foreign keys. `change()`, `dropForeign()`, `primary()`,
   * `dropPrimary()`, and standalone `foreign()` are unsupported on SQLite.
   */
  async table(table: string, build: (table: Blueprint) => void): Promise<void> {
    const blueprint = new Blueprint(table)
    build(blueprint)
    const g = this.connection.grammar
    const run = (sql: string) => this.run(sql)

    if (blueprint.droppedUserstamps && this.connection.dialect === 'sqlite') {
      throw new Error(
        '[eloquent] dropUserstamps() is not supported on SQLite (those columns carry a FK constraint — rebuild the table instead).',
      )
    }

    for (const column of blueprint.columns) {
      if (column.change) {
        for (const sql of g.compileChangeColumn(table, column)) await run(sql)
      }
      else {
        await run(g.compileAddColumn(table, column))
        // A new column's FK/unique isn't part of ADD COLUMN's DDL — each needs
        // its own statement, unlike create() where compileCreateTable folds
        // both into the CREATE TABLE's constraints.
        if (column.references)
          await run(g.compileAddForeignKeyForColumn(table, column))
        if (column.unique) {
          await run(g.compileCreateIndex(table, {
            columns: [column.name],
            unique: true,
            name: `${table}_${column.name}_unique`,
          }))
        }
        if (column.comment !== undefined) {
          const stmt = g.compileColumnComment(table, column.name, column.comment)
          if (stmt)
            await run(stmt)
        }
      }
    }
    for (const { from, to } of blueprint.renameColumns)
      await run(g.compileRenameColumn(table, from, to))
    // MySQL refuses to drop a column that's still needed by a FK constraint —
    // unlike Postgres, which cascades the constraint away automatically. The
    // constraint name is DB-auto-generated (no fixed pattern), so look it up.
    if (blueprint.droppedUserstamps && this.connection.dialect === 'mysql') {
      for (const name of blueprint.dropColumns) {
        const constraint = await foreignKeyConstraintName(this.connection, table, name)
        if (constraint)
          await run(g.compileDropForeign(table, constraint))
      }
    }
    for (const name of blueprint.dropColumns) await run(g.compileDropColumn(table, name))
    for (const index of blueprint.indexes) await run(g.compileCreateIndex(table, index))
    for (const name of blueprint.dropIndexes) await run(g.compileDropIndex(name, table))
    for (const name of blueprint.dropForeigns) await run(g.compileDropForeign(table, name))
    for (const pk of blueprint.primaryKeys) await run(g.compileAddPrimaryKey(table, pk))
    for (const name of blueprint.dropPrimaries) await run(g.compileDropPrimary(table, name))
    for (const fk of blueprint.foreignKeys) await run(g.compileAddForeignKey(table, fk))
    for (const { from, to } of blueprint.renameIndexes) await run(g.compileRenameIndex(table, from, to))
  }

  /** Rename a table. */
  async rename(from: string, to: string): Promise<void> {
    await this.run(this.connection.grammar.compileRenameTable(from, to))
  }

  async dropIfExists(table: string): Promise<void> {
    await this.run(this.connection.grammar.compileDropTableIfExists(table))
  }

  /** Re-enable FK enforcement (no session-wide equivalent on Postgres — a no-op there). */
  async enableForeignKeyConstraints(): Promise<void> {
    if (this.connection.dialect === 'sqlite')
      await this.run('PRAGMA foreign_keys = ON;')
    else if (this.connection.dialect === 'mysql')
      await this.run('SET FOREIGN_KEY_CHECKS = 1;')
  }

  /** Disable FK enforcement (no session-wide equivalent on Postgres — a no-op there). */
  async disableForeignKeyConstraints(): Promise<void> {
    if (this.connection.dialect === 'sqlite')
      await this.run('PRAGMA foreign_keys = OFF;')
    else if (this.connection.dialect === 'mysql')
      await this.run('SET FOREIGN_KEY_CHECKS = 0;')
  }

  /** Run `fn` with FK enforcement disabled, then always restore it. */
  async withoutForeignKeyConstraints<T>(fn: () => Promise<T> | T): Promise<T> {
    await this.disableForeignKeyConstraints()
    try {
      return await fn()
    }
    finally {
      await this.enableForeignKeyConstraints()
    }
  }
}
