export type Dialect = 'sqlite' | 'pg' | 'mysql'

export type ColumnType
  = | 'id'
    | 'tinyInteger'
    | 'smallInteger'
    | 'mediumInteger'
    | 'integer'
    | 'bigInteger'
    | 'float'
    | 'double'
    | 'decimal'
    | 'boolean'
    | 'char'
    | 'string'
    | 'text'
    | 'tinyText'
    | 'mediumText'
    | 'longText'
    | 'uuid'
    | 'json'
    | 'jsonb'
    | 'binary'
    | 'date'
    | 'time'
    | 'timeTz'
    | 'timestamp'
    | 'timestampTz'
    | 'datetime'
    | 'dateTimeTz'
    | 'year'
    | 'ipAddress'
    | 'macAddress'
    | 'inet'
    | 'cidr'
    | 'macaddr'
    | 'interval'
    | 'enum'
    | 'array'
    | 'geometry'
    | 'geography'
    | 'vector'

/** Foreign-key/referential action, shared by `onDelete`/`onUpdate`. */
export type RefAction = 'cascade' | 'set null' | 'restrict' | 'no action'

export interface ColumnDefinition {
  name: string
  type: ColumnType
  length?: number
  precision?: number
  scale?: number
  enumValues?: string[]
  /** Element type for `array` columns (Postgres `<type>[]`). */
  arrayOf?: ColumnType
  /**
   * Spatial subtype for `geometry`/`geography` — `'point'`, `'polygon'`,
   * `'linestring'`, … Omitted means any geometry.
   */
  subtype?: string
  /** SRID for `geometry`/`geography` (PostGIS's second type argument). */
  srid?: number
  /** Dimension count for a `vector` column (pgvector / MySQL 9 `VECTOR(n)`). */
  dimensions?: number
  nullable?: boolean
  unique?: boolean
  default?: unknown
  references?: { table: string, column: string, onDelete?: RefAction, onUpdate?: RefAction, name?: string }
  /** `UNSIGNED` on MariaDB/MySQL integer columns (ignored elsewhere, like Laravel). */
  unsigned?: boolean
  /** Column comment (MariaDB/MySQL/PostgreSQL — ignored on SQLite). */
  comment?: string
  /** `DEFAULT CURRENT_TIMESTAMP` for timestamp/datetime columns. */
  useCurrent?: boolean
  /** `ON UPDATE CURRENT_TIMESTAMP` (MariaDB/MySQL only). */
  useCurrentOnUpdate?: boolean
  /** Marks this column definition as a modification (`->change()`) rather than an add. */
  change?: boolean
  /** A generated column (`storedAs`/`virtualAs`) — computed from `expr`, not assignable directly. */
  generatedAs?: { expr: string, stored: boolean }
}

/** A standalone index (created after the table). */
export interface IndexDefinition {
  columns: string[]
  unique: boolean
  name: string
  /** MySQL `FULLTEXT INDEX`; Postgres: a functional GIN index over `to_tsvector(...)`. No SQLite equivalent. */
  fullText?: boolean
  /** MySQL `SPATIAL INDEX`. No SQLite equivalent; Postgres needs the PostGIS extension (not supported here). */
  spatial?: boolean
}

/** Table-level options for `CREATE TABLE` — set via `Blueprint.temporary()`/`engine()`/`charset()`/`collation()`. */
export interface TableOptions {
  temporary?: boolean
  /** MySQL/MariaDB only (e.g. `'InnoDB'`). */
  engine?: string
  /** MySQL/MariaDB only (e.g. `'utf8mb4'`). */
  charset?: string
  /** MySQL/MariaDB only (e.g. `'utf8mb4_unicode_ci'`). */
  collation?: string
}

/** A composite (or single-column) primary key, added separately from `id()`. */
export interface PrimaryKeyDefinition {
  columns: string[]
  name?: string
}

/** A standalone foreign key constraint on one or more existing columns. */
export interface ForeignKeyDefinition {
  columns: string[]
  name?: string
  references?: { table: string, column: string }
  onDelete?: RefAction
  onUpdate?: RefAction
}

/**
 * Renders dialect-specific SQL from dialect-neutral input — Laravel's grammar
 * pattern. Postgres uses its native types; SQLite falls back to the closest
 * affinity so the same migration runs on both.
 */
export abstract class Grammar {
  abstract readonly dialect: Dialect
  /** Whether `INSERT ... RETURNING *` is supported (false on MySQL — emulated). */
  readonly supportsReturning: boolean = true
  abstract placeholder(index: number): string
  protected abstract columnType(column: ColumnDefinition): string

  /**
   * `GEOMETRY`, `GEOMETRY(Point)` or `GEOMETRY(Point,4326)` — PostGIS's form,
   * which MySQL accepts the bare/subtype spelling of.
   */
  protected spatialType(keyword: string, column: ColumnDefinition): string {
    if (!column.subtype)
      return keyword
    const subtype = column.subtype.replace(/[^a-z0-9]/gi, '')
    return column.srid === undefined
      ? `${keyword}(${subtype})`
      : `${keyword}(${subtype},${column.srid})`
  }

  /** `VECTOR(n)`; the dimension count is required by both pgvector and MySQL 9. */
  protected vectorType(column: ColumnDefinition): string {
    if (column.dimensions === undefined || !Number.isInteger(column.dimensions) || column.dimensions <= 0) {
      throw new Error(
        `[eloquent] The vector column "${column.name}" needs a positive integer `
        + 'dimension count, e.g. `t.vector(\'embedding\', 1536)`.',
      )
    }
    return `VECTOR(${column.dimensions})`
  }

  wrap(identifier: string): string {
    return identifier
      .split('.')
      .map(part => (part === '*' ? part : `"${part.replace(/"/g, '""')}"`))
      .join('.')
  }

  compileCreateTable(
    table: string,
    columns: ColumnDefinition[],
    primaryKeys: PrimaryKeyDefinition[] = [],
    options: TableOptions = {},
  ): string {
    const defs = columns.map(c => this.compileColumn(c))
    const constraints: string[] = []
    for (const c of columns) {
      if (c.unique && c.type !== 'id')
        constraints.push(`UNIQUE (${this.wrap(c.name)})`)
      if (c.references)
        constraints.push(this.foreignKeyConstraint(c.references, [c.name]))
    }
    for (const pk of primaryKeys)
      constraints.push(`PRIMARY KEY (${pk.columns.map(c => this.wrap(c)).join(', ')})`)
    // TEMP/TEMPORARY are synonyms in every dialect here (Postgres, MySQL, SQLite).
    const temp = options.temporary ? 'TEMPORARY ' : ''
    let sql = `CREATE ${temp}TABLE ${this.wrap(table)} (${[...defs, ...constraints].join(', ')})`
    if (this.dialect === 'mysql') {
      if (options.engine)
        sql += ` ENGINE=${options.engine}`
      if (options.charset)
        sql += ` DEFAULT CHARSET=${options.charset}`
      if (options.collation)
        sql += ` COLLATE=${options.collation}`
    }
    // engine/charset/collation have no table-level equivalent on Postgres/SQLite
    // (Postgres charset/collation are database- or column-level, not table-level;
    // SQLite has neither concept) — silently ignored there, like `comment()`.
    return sql
  }

  /** Shared `FOREIGN KEY (...) REFERENCES ... ON DELETE ... ON UPDATE ...` fragment. */
  protected foreignKeyConstraint(
    references: { table: string, column: string, onDelete?: RefAction, onUpdate?: RefAction },
    columns: string[],
  ): string {
    const onDelete = references.onDelete ? ` ON DELETE ${references.onDelete.toUpperCase()}` : ''
    const onUpdate = references.onUpdate ? ` ON UPDATE ${references.onUpdate.toUpperCase()}` : ''
    const cols = columns.map(c => this.wrap(c)).join(', ')
    return `FOREIGN KEY (${cols}) REFERENCES ${this.wrap(references.table)} (${this.wrap(references.column)})${onDelete}${onUpdate}`
  }

  compileDropTableIfExists(table: string): string {
    const cascade = this.dialect === 'pg' ? ' CASCADE' : ''
    return `DROP TABLE IF EXISTS ${this.wrap(table)}${cascade}`
  }

  compileAddColumn(table: string, column: ColumnDefinition): string {
    return `ALTER TABLE ${this.wrap(table)} ADD COLUMN ${this.compileColumn(column)}`
  }

  /** A separate `ADD CONSTRAINT ... FOREIGN KEY` for a column added via `table()` (ALTER). */
  compileAddForeignKeyForColumn(table: string, column: ColumnDefinition): string {
    if (!column.references)
      throw new Error('[eloquent] compileAddForeignKeyForColumn called on a column with no references.')
    if (this.dialect === 'sqlite') {
      throw new Error(
        '[eloquent] A foreign key added via table() is not supported on SQLite — define it in create() instead.',
      )
    }
    const name = column.references.name ?? this.defaultConstraintName(table, [column.name], 'foreign')
    return `ALTER TABLE ${this.wrap(table)} ADD CONSTRAINT ${this.wrap(name)} ${this.foreignKeyConstraint(column.references, [column.name])}`
  }

  /** `foreign([...]).references(...).on(...)` — a standalone FK not tied to a column push. */
  compileAddForeignKey(table: string, fk: ForeignKeyDefinition): string {
    if (!fk.references)
      throw new Error('[eloquent] foreign() requires .references(column).on(table).')
    if (this.dialect === 'sqlite') {
      throw new Error(
        '[eloquent] foreign() is not supported on SQLite — define the foreign key in create() instead.',
      )
    }
    const name = fk.name ?? this.defaultConstraintName(table, fk.columns, 'foreign')
    return `ALTER TABLE ${this.wrap(table)} ADD CONSTRAINT ${this.wrap(name)} ${this.foreignKeyConstraint({ ...fk.references, onDelete: fk.onDelete, onUpdate: fk.onUpdate }, fk.columns)}`
  }

  compileAddPrimaryKey(table: string, pk: PrimaryKeyDefinition): string {
    if (this.dialect === 'sqlite') {
      throw new Error(
        '[eloquent] Adding a primary key via table() is not supported on SQLite — define it in create() instead.',
      )
    }
    return `ALTER TABLE ${this.wrap(table)} ADD PRIMARY KEY (${pk.columns.map(c => this.wrap(c)).join(', ')})`
  }

  compileDropPrimary(table: string, name?: string): string {
    if (this.dialect === 'sqlite') {
      throw new Error('[eloquent] dropPrimary is not supported on SQLite (rebuild the table instead).')
    }
    if (this.dialect === 'mysql')
      return `ALTER TABLE ${this.wrap(table)} DROP PRIMARY KEY`
    return `ALTER TABLE ${this.wrap(table)} DROP CONSTRAINT ${this.wrap(name ?? this.defaultConstraintName(table, ['pkey'], ''))}`
  }

  compileRenameIndex(table: string, from: string, to: string): string {
    if (this.dialect === 'sqlite') {
      throw new Error('[eloquent] renameIndex is not supported on SQLite (drop and recreate instead).')
    }
    if (this.dialect === 'mysql')
      return `ALTER TABLE ${this.wrap(table)} RENAME INDEX ${this.wrap(from)} TO ${this.wrap(to)}`
    return `ALTER INDEX ${this.wrap(from)} RENAME TO ${this.wrap(to)}`
  }

  /** Postgres needs a separate `COMMENT ON COLUMN` — MySQL inlines it, SQLite has no comments. */
  compileColumnComment(table: string, column: string, comment: string): string | null {
    if (this.dialect !== 'pg')
      return null
    return `COMMENT ON COLUMN ${this.wrap(table)}.${this.wrap(column)} IS ${this.literal(comment)}`
  }

  protected defaultConstraintName(table: string, columns: string[], suffix: string): string {
    return [table, ...columns, suffix].filter(Boolean).join('_')
  }

  compileCreateIndex(table: string, index: IndexDefinition): string {
    if (index.fullText)
      return this.compileFullTextIndex(table, index)
    if (index.spatial)
      return this.compileSpatialIndex(table, index)
    const unique = index.unique ? 'UNIQUE ' : ''
    const cols = index.columns.map(c => this.wrap(c)).join(', ')
    return `CREATE ${unique}INDEX ${this.wrap(index.name)} ON ${this.wrap(table)} (${cols})`
  }

  private compileFullTextIndex(table: string, index: IndexDefinition): string {
    const cols = index.columns.map(c => this.wrap(c)).join(', ')
    if (this.dialect === 'mysql')
      return `ALTER TABLE ${this.wrap(table)} ADD FULLTEXT INDEX ${this.wrap(index.name)} (${cols})`
    if (this.dialect === 'pg') {
      const concat = index.columns.map(c => this.wrap(c)).join(` || ' ' || `)
      return `CREATE INDEX ${this.wrap(index.name)} ON ${this.wrap(table)} USING GIN (to_tsvector('english', ${concat}))`
    }
    throw new Error(
      '[eloquent] fullText() is not supported on SQLite — whereFullText() still works there via a LIKE fallback, it just has no dedicated index to speed it up.',
    )
  }

  private compileSpatialIndex(table: string, index: IndexDefinition): string {
    if (this.dialect === 'mysql') {
      const cols = index.columns.map(c => this.wrap(c)).join(', ')
      return `ALTER TABLE ${this.wrap(table)} ADD SPATIAL INDEX ${this.wrap(index.name)} (${cols})`
    }
    if (this.dialect === 'pg') {
      throw new Error(
        '[eloquent] spatialIndex() on Postgres requires the PostGIS extension, which isn\'t assumed to be installed — add the GIST index yourself via a raw migration statement if PostGIS is available.',
      )
    }
    throw new Error('[eloquent] spatialIndex() is not supported on SQLite.')
  }

  compileDropColumn(table: string, name: string): string {
    return `ALTER TABLE ${this.wrap(table)} DROP COLUMN ${this.wrap(name)}`
  }

  compileRenameColumn(table: string, from: string, to: string): string {
    return `ALTER TABLE ${this.wrap(table)} RENAME COLUMN ${this.wrap(from)} TO ${this.wrap(to)}`
  }

  compileRenameTable(from: string, to: string): string {
    return `ALTER TABLE ${this.wrap(from)} RENAME TO ${this.wrap(to)}`
  }

  compileDropIndex(name: string, _table: string): string {
    return `DROP INDEX ${this.wrap(name)}`
  }

  compileDropForeign(table: string, name: string): string {
    if (this.dialect === 'sqlite') {
      throw new Error(
        '[eloquent] dropForeign is not supported on SQLite (rebuild the table instead).',
      )
    }
    const keyword = this.dialect === 'mysql' ? 'FOREIGN KEY' : 'CONSTRAINT'
    return `ALTER TABLE ${this.wrap(table)} DROP ${keyword} ${this.wrap(name)}`
  }

  /** Modify a column's type/nullability/default. Not supported on SQLite (can't ALTER type). */
  compileChangeColumn(table: string, column: ColumnDefinition): string[] {
    if (this.dialect === 'sqlite') {
      throw new Error(
        '[eloquent] Column change() is not supported on SQLite (rebuild the table instead).',
      )
    }
    // MySQL restates the whole column definition in one MODIFY COLUMN statement.
    if (this.dialect === 'mysql') {
      return [`ALTER TABLE ${this.wrap(table)} MODIFY COLUMN ${this.compileColumn(column)}`]
    }
    const t = this.wrap(table)
    const col = this.wrap(column.name)
    const stmts = [`ALTER TABLE ${t} ALTER COLUMN ${col} TYPE ${this.columnType(column)}`]
    stmts.push(
      `ALTER TABLE ${t} ALTER COLUMN ${col} ${column.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'}`,
    )
    if (column.default !== undefined) {
      stmts.push(`ALTER TABLE ${t} ALTER COLUMN ${col} SET DEFAULT ${this.literal(column.default)}`)
    }
    return stmts
  }

  protected compileColumn(column: ColumnDefinition): string {
    const parts = [this.wrap(column.name), this.columnType(column)]
    if (column.unsigned && this.dialect === 'mysql')
      parts.push('UNSIGNED')
    if (column.generatedAs) {
      if (this.dialect === 'pg' && !column.generatedAs.stored) {
        throw new Error(
          '[eloquent] virtualAs() is not supported on Postgres — Postgres only supports STORED generated columns, use storedAs() instead.',
        )
      }
      const storage = column.generatedAs.stored ? 'STORED' : 'VIRTUAL'
      parts.push(`GENERATED ALWAYS AS (${column.generatedAs.expr}) ${storage}`)
      return parts.join(' ')
    }
    if (column.type !== 'id') {
      parts.push(column.nullable ? 'NULL' : 'NOT NULL')
      if (column.useCurrent && column.default === undefined)
        parts.push('DEFAULT CURRENT_TIMESTAMP')
      else if (column.default !== undefined)
        parts.push(`DEFAULT ${this.literal(column.default)}`)
      if (column.useCurrentOnUpdate && this.dialect === 'mysql')
        parts.push('ON UPDATE CURRENT_TIMESTAMP')
    }
    if (column.enumValues?.length) {
      const list = column.enumValues.map(v => this.literal(v)).join(', ')
      parts.push(`CHECK (${this.wrap(column.name)} IN (${list}))`)
    }
    if (column.comment !== undefined && this.dialect === 'mysql')
      parts.push(`COMMENT ${this.literal(column.comment)}`)
    return parts.join(' ')
  }

  protected literal(value: unknown): string {
    if (value === null)
      return 'NULL'
    if (typeof value === 'number')
      return String(value)
    if (typeof value === 'boolean')
      return this.dialect === 'pg' ? String(value) : value ? '1' : '0'
    return `'${String(value).replace(/'/g, '\'\'')}'`
  }
}

class SqliteGrammar extends Grammar {
  readonly dialect = 'sqlite' as const
  placeholder(): string {
    return '?'
  }

  protected columnType(c: ColumnDefinition): string {
    switch (c.type) {
      case 'id':
        return 'INTEGER PRIMARY KEY AUTOINCREMENT'
      case 'tinyInteger':
      case 'smallInteger':
      case 'mediumInteger':
      case 'integer':
      case 'bigInteger':
      case 'boolean':
      case 'year':
        return 'INTEGER'
      case 'float':
      case 'double':
        return 'REAL'
      case 'decimal':
        return 'NUMERIC'
      case 'binary':
        return 'BLOB'
      // SQLite has no spatial or vector types (those need SpatiaLite / an
      // extension). The column is created with the declared type name — SQLite is
      // dynamically typed, so it accepts it and gives it BLOB affinity — but no
      // spatial/vector FUNCTION will work. Creating it keeps a schema portable
      // across dialects for dev/test; the queries are what won't port.
      case 'geometry':
      case 'geography':
        return this.spatialType('GEOMETRY', c)
      case 'vector':
        return this.vectorType(c)
      // array + everything else stores as TEXT (JSON) under SQLite.
      default:
        return 'TEXT'
    }
  }
}

class PostgresGrammar extends Grammar {
  readonly dialect = 'pg' as const
  placeholder(index: number): string {
    return `$${index + 1}`
  }

  protected columnType(c: ColumnDefinition): string {
    switch (c.type) {
      case 'id':
        return 'SERIAL PRIMARY KEY'
      case 'tinyInteger':
      case 'year':
        return 'SMALLINT'
      case 'smallInteger':
        return 'SMALLINT'
      case 'mediumInteger':
      case 'integer':
        return 'INTEGER'
      case 'bigInteger':
        return 'BIGINT'
      case 'float':
        return 'REAL'
      case 'double':
        return 'DOUBLE PRECISION'
      case 'decimal':
        return `NUMERIC(${c.precision ?? 10}, ${c.scale ?? 2})`
      case 'boolean':
        return 'BOOLEAN'
      case 'char':
        return `CHAR(${c.length ?? 255})`
      case 'string':
      case 'enum':
        return `VARCHAR(${c.length ?? 255})`
      case 'text':
      case 'tinyText':
      case 'mediumText':
      case 'longText':
        return 'TEXT'
      case 'uuid':
        return 'UUID'
      // json/date/timestamp/datetime stay TEXT so values are ISO strings and
      // identical across dialects (model casts handle them). Use jsonb /
      // timestampTz for the native, timezone-aware/indexable Postgres types.
      case 'json':
      case 'date':
      case 'timestamp':
      case 'datetime':
        return 'TEXT'
      case 'jsonb':
        return 'JSONB'
      case 'binary':
        return 'BYTEA'
      case 'time':
        return 'TIME'
      case 'timeTz':
        return 'TIMETZ'
      case 'timestampTz':
      case 'dateTimeTz':
        return 'TIMESTAMPTZ'
      case 'ipAddress':
      case 'inet':
        return 'INET'
      case 'cidr':
        return 'CIDR'
      case 'macAddress':
      case 'macaddr':
        return 'MACADDR'
      case 'interval':
        return 'INTERVAL'
      case 'array':
        return `${this.columnType({ name: '', type: c.arrayOf ?? 'text' })}[]`
      // PostGIS / pgvector types. Both come from extensions, so the migration
      // needs `CREATE EXTENSION IF NOT EXISTS postgis` / `vector` to have run.
      case 'geometry':
        return this.spatialType('GEOMETRY', c)
      case 'geography':
        return this.spatialType('GEOGRAPHY', c)
      case 'vector':
        return this.vectorType(c)
    }
  }
}

class MysqlGrammar extends Grammar {
  readonly dialect = 'mysql' as const

  private mysqlSpatial(column: ColumnDefinition): string {
    const keyword = column.subtype ? column.subtype.replace(/[^a-z0-9]/gi, '').toUpperCase() : 'GEOMETRY'
    return column.srid === undefined ? keyword : `${keyword} SRID ${column.srid}`
  }

  // MySQL has no RETURNING — the query builder emulates it via LAST_INSERT_ID.
  override readonly supportsReturning = false
  placeholder(): string {
    return '?'
  }

  override wrap(identifier: string): string {
    return identifier
      .split('.')
      .map(part => (part === '*' ? part : `\`${part.replace(/`/g, '``')}\``))
      .join('.')
  }

  // MySQL can't `DROP INDEX name` standalone — it needs the owning table.
  override compileDropIndex(name: string, table: string): string {
    return `ALTER TABLE ${this.wrap(table)} DROP INDEX ${this.wrap(name)}`
  }

  protected columnType(c: ColumnDefinition): string {
    switch (c.type) {
      case 'id':
        return 'BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY'
      case 'tinyInteger':
        return 'TINYINT'
      case 'smallInteger':
        return 'SMALLINT'
      case 'mediumInteger':
        return 'MEDIUMINT'
      case 'integer':
        return 'INT'
      case 'bigInteger':
        return 'BIGINT'
      case 'year':
        return 'YEAR'
      case 'float':
        return 'FLOAT'
      case 'double':
        return 'DOUBLE'
      case 'decimal':
        return `DECIMAL(${c.precision ?? 10}, ${c.scale ?? 2})`
      case 'boolean':
        return 'TINYINT(1)'
      case 'char':
        return `CHAR(${c.length ?? 255})`
      case 'string':
      case 'enum':
        return `VARCHAR(${c.length ?? 255})`
      case 'uuid':
        return 'CHAR(36)'
      case 'text':
        return 'TEXT'
      case 'tinyText':
        return 'TINYTEXT'
      case 'mediumText':
        return 'MEDIUMTEXT'
      case 'longText':
        return 'LONGTEXT'
      case 'binary':
        return 'BLOB'
      case 'time':
      case 'timeTz':
        return 'TIME'
      case 'ipAddress':
        return 'VARCHAR(45)'
      case 'macAddress':
        return 'VARCHAR(17)'
      // json/date/timestamp/datetime/dateTimeTz stay TEXT so values are ISO
      // strings and identical across dialects (model casts handle them),
      // mirroring Postgres — MySQL has no tz-aware datetime type anyway.
      // jsonb maps to MySQL's native JSON; timestampTz to UTC-normalized TIMESTAMP.
      case 'jsonb':
        return 'JSON'
      case 'timestampTz':
        return 'TIMESTAMP'
      // MySQL's spatial types are native. A subtype maps to the concrete type
      // (POINT, POLYGON …) rather than a parameterized GEOMETRY, and an SRID
      // becomes the column's `SRID` attribute. `geography` has no MySQL
      // equivalent — spatial columns there are geometry with an SRID.
      case 'geometry':
      case 'geography':
        return this.mysqlSpatial(c)
      case 'vector':
        return this.vectorType(c)
      default:
        return 'TEXT'
    }
  }
}

export function grammarFor(dialect: Dialect): Grammar {
  switch (dialect) {
    case 'pg':
      return new PostgresGrammar()
    case 'mysql':
      return new MysqlGrammar()
    default:
      return new SqliteGrammar()
  }
}
