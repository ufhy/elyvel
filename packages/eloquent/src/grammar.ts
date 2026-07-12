export type Dialect = 'sqlite' | 'pg'

/** A column definition collected by the schema {@link Blueprint}. */
export interface ColumnDefinition {
  name: string
  type:
    | 'id'
    | 'string'
    | 'text'
    | 'integer'
    | 'bigInteger'
    | 'boolean'
    | 'timestamp'
    | 'json'
    | 'uuid'
    | 'decimal'
    | 'date'
    | 'datetime'
  length?: number
  precision?: number
  scale?: number
  nullable?: boolean
  unique?: boolean
  default?: unknown
  references?: { table: string; column: string; onDelete?: 'cascade' | 'set null' | 'restrict' }
}

/** A standalone index (created after the table). */
export interface IndexDefinition {
  columns: string[]
  unique: boolean
  name: string
}

/**
 * Renders dialect-specific SQL from dialect-neutral input — the same idea as
 * Laravel's query/schema "grammars". This is what lets one model/migration run
 * on SQLite and Postgres unchanged.
 */
export abstract class Grammar {
  abstract readonly dialect: Dialect

  /** Positional placeholder for the i-th binding (0-based): `?` or `$n`. */
  abstract placeholder(index: number): string

  protected abstract columnType(column: ColumnDefinition): string

  /** Quote an identifier. Both dialects accept double quotes. */
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

  protected compileColumn(column: ColumnDefinition): string {
    const parts = [this.wrap(column.name), this.columnType(column)]
    if (column.type !== 'id') {
      parts.push(column.nullable ? 'NULL' : 'NOT NULL')
      if (column.default !== undefined) parts.push(`DEFAULT ${this.literal(column.default)}`)
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
      case 'string':
      case 'text':
      case 'timestamp':
      case 'json':
      case 'uuid':
      case 'date':
      case 'datetime':
        return 'TEXT'
      case 'decimal':
        return 'NUMERIC'
      case 'integer':
      case 'bigInteger':
      case 'boolean':
        return 'INTEGER'
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
      case 'string':
        return `VARCHAR(${c.length ?? 255})`
      case 'text':
      case 'timestamp': // stored as ISO string for identical behavior across dialects
      case 'json': // stored as text (JSON string) for identical behavior across dialects
      case 'date':
      case 'datetime':
        return 'TEXT'
      case 'uuid':
        return 'VARCHAR(36)'
      case 'decimal':
        return `NUMERIC(${c.precision ?? 10}, ${c.scale ?? 2})`
      case 'integer':
        return 'INTEGER'
      case 'bigInteger':
        return 'BIGINT'
      case 'boolean':
        return 'BOOLEAN'
    }
  }
}

export function grammarFor(dialect: Dialect): Grammar {
  return dialect === 'pg' ? new PostgresGrammar() : new SqliteGrammar()
}
