import type { Connection } from './connection'
import type { ColumnDefinition, IndexDefinition } from './grammar'

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
  /** `foreignId('user_id').constrained('users')` → FK to users(id). */
  constrained(table: string, column = 'id'): this {
    this.def.references = { table, column }
    return this
  }
  cascadeOnDelete(): this {
    if (this.def.references) this.def.references.onDelete = 'cascade'
    return this
  }
  nullOnDelete(): this {
    if (this.def.references) this.def.references.onDelete = 'set null'
    return this
  }
}

/**
 * Collects a table's columns dialect-neutrally (Laravel's `Blueprint`). The
 * grammar turns these into dialect-correct DDL.
 */
export class Blueprint {
  readonly columns: ColumnDefinition[] = []
  readonly indexes: IndexDefinition[] = []

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
  integer(name: string): ColumnBuilder {
    return this.push({ name, type: 'integer' })
  }
  bigInteger(name: string): ColumnBuilder {
    return this.push({ name, type: 'bigInteger' })
  }
  boolean(name: string): ColumnBuilder {
    return this.push({ name, type: 'boolean' })
  }
  timestamp(name: string): ColumnBuilder {
    return this.push({ name, type: 'timestamp' })
  }
  json(name: string): ColumnBuilder {
    return this.push({ name, type: 'json' })
  }
  foreignId(name: string): ColumnBuilder {
    return this.push({ name, type: 'bigInteger' })
  }
  uuid(name: string): ColumnBuilder {
    return this.push({ name, type: 'uuid' })
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
  /** A standalone (optionally composite) index. */
  index(columns: string | string[], name?: string): void {
    const cols = Array.isArray(columns) ? columns : [columns]
    this.indexes.push({ columns: cols, unique: false, name: name ?? `idx_${cols.join('_')}` })
  }
  /** `created_at` + `updated_at` (nullable timestamps managed by the model). */
  timestamps(): void {
    this.push({ name: 'created_at', type: 'timestamp', nullable: true })
    this.push({ name: 'updated_at', type: 'timestamp', nullable: true })
  }
  /** `deleted_at` nullable timestamp for soft deletes. */
  softDeletes(): ColumnBuilder {
    return this.push({ name: 'deleted_at', type: 'timestamp', nullable: true })
  }
}

/** Dialect-agnostic schema builder used inside migrations. */
export class SchemaBuilder {
  constructor(private readonly connection: Connection) {}

  async create(table: string, build: (table: Blueprint) => void): Promise<void> {
    const blueprint = new Blueprint()
    build(blueprint)
    const g = this.connection.grammar
    await this.connection.statement(g.compileCreateTable(table, blueprint.columns))
    for (const index of blueprint.indexes) {
      await this.connection.statement(g.compileCreateIndex(table, index))
    }
  }

  /** Alter a table: add columns / indexes (`ADD COLUMN`, `CREATE INDEX`). */
  async table(table: string, build: (table: Blueprint) => void): Promise<void> {
    const blueprint = new Blueprint()
    build(blueprint)
    const g = this.connection.grammar
    for (const column of blueprint.columns) {
      await this.connection.statement(g.compileAddColumn(table, column))
    }
    for (const index of blueprint.indexes) {
      await this.connection.statement(g.compileCreateIndex(table, index))
    }
  }

  async dropIfExists(table: string): Promise<void> {
    await this.connection.statement(this.connection.grammar.compileDropTableIfExists(table))
  }
}
