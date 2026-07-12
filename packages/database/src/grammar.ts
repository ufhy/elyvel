export type Dialect = 'sqlite' | 'pg'

export type ColumnType =
  | 'id'
  | 'smallInteger'
  | 'integer'
  | 'bigInteger'
  | 'float'
  | 'double'
  | 'decimal'
  | 'boolean'
  | 'char'
  | 'string'
  | 'text'
  | 'mediumText'
  | 'longText'
  | 'uuid'
  | 'json'
  | 'jsonb'
  | 'binary'
  | 'date'
  | 'time'
  | 'timestamp'
  | 'timestampTz'
  | 'datetime'
  | 'inet'
  | 'cidr'
  | 'macaddr'
  | 'interval'
  | 'enum'
  | 'array'

export interface ColumnDefinition {
  name: string
  type: ColumnType
  length?: number
  precision?: number
  scale?: number
  enumValues?: string[]
  /** Element type for `array` columns (Postgres `<type>[]`). */
  arrayOf?: ColumnType
  nullable?: boolean
  unique?: boolean
  default?: unknown
  references?: { table: string; column: string; onDelete?: 'cascade' | 'set null' | 'restrict' }
  /** Marks this column definition as a modification (`->change()`) rather than an add. */
  change?: boolean
}

/** A standalone index (created after the table). */
export interface IndexDefinition {
  columns: string[]
  unique: boolean
  name: string
}

/**
 * Renders dialect-specific SQL from dialect-neutral input — Laravel's grammar
 * pattern. Postgres uses its native types; SQLite falls back to the closest
 * affinity so the same migration runs on both.
 */
export abstract class Grammar {
  abstract readonly dialect: Dialect
  abstract placeholder(index: number): string
  protected abstract columnType(column: ColumnDefinition): string

  wrap(identifier: string): string {
    return identifier
      .split('.')
      .map((part) => (part === '*' ? part : `"${part.replace(/"/g, '""')}"`))
      .join('.')
  }

  compileCreateTable(table: string, columns: ColumnDefinition[]): string {
    const defs = columns.map((c) => this.compileColumn(c))
    const constraints: string[] = []
    for (const c of columns) {
      if (c.unique && c.type !== 'id') constraints.push(`UNIQUE (${this.wrap(c.name)})`)
      if (c.references) {
        const onDelete = c.references.onDelete
          ? ` ON DELETE ${c.references.onDelete.toUpperCase()}`
          : ''
        constraints.push(
          `FOREIGN KEY (${this.wrap(c.name)}) REFERENCES ${this.wrap(c.references.table)} (${this.wrap(c.references.column)})${onDelete}`,
        )
      }
    }
    return `CREATE TABLE ${this.wrap(table)} (${[...defs, ...constraints].join(', ')})`
  }

  compileDropTableIfExists(table: string): string {
    const cascade = this.dialect === 'pg' ? ' CASCADE' : ''
    return `DROP TABLE IF EXISTS ${this.wrap(table)}${cascade}`
  }
  compileAddColumn(table: string, column: ColumnDefinition): string {
    return `ALTER TABLE ${this.wrap(table)} ADD COLUMN ${this.compileColumn(column)}`
  }
  compileCreateIndex(table: string, index: IndexDefinition): string {
    const unique = index.unique ? 'UNIQUE ' : ''
    const cols = index.columns.map((c) => this.wrap(c)).join(', ')
    return `CREATE ${unique}INDEX ${this.wrap(index.name)} ON ${this.wrap(table)} (${cols})`
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
  compileDropIndex(name: string): string {
    return `DROP INDEX ${this.wrap(name)}`
  }
  compileDropForeign(table: string, name: string): string {
    if (this.dialect !== 'pg') {
      throw new Error('[eloquent] dropForeign is not supported on SQLite (rebuild the table instead).')
    }
    return `ALTER TABLE ${this.wrap(table)} DROP CONSTRAINT ${this.wrap(name)}`
  }
  /** Modify a column's type/nullability/default. Postgres only (SQLite can't ALTER type). */
  compileChangeColumn(table: string, column: ColumnDefinition): string[] {
    if (this.dialect !== 'pg') {
      throw new Error('[eloquent] Column change() is not supported on SQLite (rebuild the table instead).')
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
    if (column.type !== 'id') {
      parts.push(column.nullable ? 'NULL' : 'NOT NULL')
      if (column.default !== undefined) parts.push(`DEFAULT ${this.literal(column.default)}`)
    }
    if (column.enumValues?.length) {
      const list = column.enumValues.map((v) => this.literal(v)).join(', ')
      parts.push(`CHECK (${this.wrap(column.name)} IN (${list}))`)
    }
    return parts.join(' ')
  }

  protected literal(value: unknown): string {
    if (value === null) return 'NULL'
    if (typeof value === 'number') return String(value)
    if (typeof value === 'boolean') return this.dialect === 'pg' ? String(value) : value ? '1' : '0'
    return `'${String(value).replace(/'/g, "''")}'`
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
      case 'smallInteger':
      case 'integer':
      case 'bigInteger':
      case 'boolean':
        return 'INTEGER'
      case 'float':
      case 'double':
        return 'REAL'
      case 'decimal':
        return 'NUMERIC'
      case 'binary':
        return 'BLOB'
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
      case 'smallInteger':
        return 'SMALLINT'
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
      case 'timestampTz':
        return 'TIMESTAMPTZ'
      case 'inet':
        return 'INET'
      case 'cidr':
        return 'CIDR'
      case 'macaddr':
        return 'MACADDR'
      case 'interval':
        return 'INTERVAL'
      case 'array':
        return `${this.columnType({ name: '', type: c.arrayOf ?? 'text' })}[]`
    }
  }
}

export function grammarFor(dialect: Dialect): Grammar {
  return dialect === 'pg' ? new PostgresGrammar() : new SqliteGrammar()
}
