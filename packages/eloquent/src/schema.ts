import type { Connection } from './connection'
import type { ColumnDefinition } from './grammar'

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
    await this.connection.statement(
      this.connection.grammar.compileCreateTable(table, blueprint.columns),
    )
  }

  async dropIfExists(table: string): Promise<void> {
    await this.connection.statement(this.connection.grammar.compileDropTableIfExists(table))
  }
}
