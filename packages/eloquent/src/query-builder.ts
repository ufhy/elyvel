import type { Connection } from './connection'

export type Operator = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'like'
type Row = Record<string, unknown>

interface WhereClause {
  boolean: 'AND' | 'OR'
  column: string
  operator: string
  value: unknown
  kind: 'basic' | 'in' | 'null' | 'notNull'
  values?: unknown[]
}

/**
 * Fluent, dialect-agnostic query builder. Accumulates clauses; the connection's
 * grammar renders SQL + bindings, so the same chain runs on SQLite or Postgres.
 */
export class QueryBuilder {
  private wheres: WhereClause[] = []
  private orders: { column: string; direction: 'ASC' | 'DESC' }[] = []
  private limitValue?: number
  private offsetValue?: number

  constructor(
    private readonly connection: Connection,
    private readonly table: string,
  ) {}

  where(column: string, operatorOrValue: unknown, value?: unknown): this {
    return this.addWhere('AND', column, operatorOrValue, value)
  }
  orWhere(column: string, operatorOrValue: unknown, value?: unknown): this {
    return this.addWhere('OR', column, operatorOrValue, value)
  }
  whereIn(column: string, values: unknown[]): this {
    this.wheres.push({ boolean: 'AND', column, operator: 'IN', value: null, kind: 'in', values })
    return this
  }
  whereNull(column: string): this {
    this.wheres.push({ boolean: 'AND', column, operator: 'IS NULL', value: null, kind: 'null' })
    return this
  }
  whereNotNull(column: string): this {
    this.wheres.push({
      boolean: 'AND',
      column,
      operator: 'IS NOT NULL',
      value: null,
      kind: 'notNull',
    })
    return this
  }
  orderBy(column: string, direction: 'asc' | 'desc' = 'asc'): this {
    this.orders.push({ column, direction: direction.toUpperCase() as 'ASC' | 'DESC' })
    return this
  }
  limit(n: number): this {
    this.limitValue = n
    return this
  }
  offset(n: number): this {
    this.offsetValue = n
    return this
  }

  private addWhere(
    boolean: 'AND' | 'OR',
    column: string,
    operatorOrValue: unknown,
    value?: unknown,
  ): this {
    const [operator, val] =
      value === undefined ? ['=', operatorOrValue] : [String(operatorOrValue), value]
    this.wheres.push({ boolean, column, operator, value: val, kind: 'basic' })
    return this
  }

  private compileWheres(bindings: unknown[]): string {
    if (!this.wheres.length) return ''
    const g = this.connection.grammar
    const parts = this.wheres.map((w, i) => {
      const prefix = i === 0 ? '' : `${w.boolean} `
      if (w.kind === 'null' || w.kind === 'notNull') {
        return `${prefix}${g.wrap(w.column)} ${w.operator}`
      }
      if (w.kind === 'in') {
        const phs = (w.values ?? []).map((v) => {
          const ph = g.placeholder(bindings.length)
          bindings.push(v)
          return ph
        })
        return `${prefix}${g.wrap(w.column)} IN (${phs.join(', ')})`
      }
      const ph = g.placeholder(bindings.length)
      bindings.push(w.value)
      return `${prefix}${g.wrap(w.column)} ${w.operator} ${ph}`
    })
    return ` WHERE ${parts.join(' ')}`
  }

  toSql(): { sql: string; bindings: unknown[] } {
    const g = this.connection.grammar
    const bindings: unknown[] = []
    let sql = `SELECT * FROM ${g.wrap(this.table)}`
    sql += this.compileWheres(bindings)
    if (this.orders.length) {
      sql += ` ORDER BY ${this.orders.map((o) => `${g.wrap(o.column)} ${o.direction}`).join(', ')}`
    }
    if (this.limitValue !== undefined) sql += ` LIMIT ${this.limitValue}`
    if (this.offsetValue !== undefined) sql += ` OFFSET ${this.offsetValue}`
    return { sql, bindings }
  }

  async get(): Promise<Row[]> {
    const { sql, bindings } = this.toSql()
    return this.connection.select<Row>(sql, bindings)
  }
  async first(): Promise<Row | undefined> {
    const rows = await this.limit(1).get()
    return rows[0]
  }
  async count(): Promise<number> {
    const g = this.connection.grammar
    const bindings: unknown[] = []
    const sql = `SELECT COUNT(*) AS count FROM ${g.wrap(this.table)}${this.compileWheres(bindings)}`
    const rows = await this.connection.select<{ count: number | string }>(sql, bindings)
    return Number(rows[0]?.count ?? 0)
  }
  async exists(): Promise<boolean> {
    return (await this.count()) > 0
  }

  /** Insert one row and return it (via RETURNING). */
  async insert(values: Row): Promise<Row> {
    const g = this.connection.grammar
    const columns = Object.keys(values)
    const bindings = Object.values(values)
    const cols = columns.map((c) => g.wrap(c)).join(', ')
    const phs = columns.map((_, i) => g.placeholder(i)).join(', ')
    const sql = `INSERT INTO ${g.wrap(this.table)} (${cols}) VALUES (${phs}) RETURNING *`
    const rows = await this.connection.select<Row>(sql, bindings)
    return rows[0] as Row
  }

  async update(values: Row): Promise<void> {
    const g = this.connection.grammar
    const bindings: unknown[] = []
    const sets = Object.entries(values).map(([col, val]) => {
      const ph = g.placeholder(bindings.length)
      bindings.push(val)
      return `${g.wrap(col)} = ${ph}`
    })
    const sql = `UPDATE ${g.wrap(this.table)} SET ${sets.join(', ')}${this.compileWheres(bindings)}`
    await this.connection.statement(sql, bindings)
  }

  async delete(): Promise<void> {
    const g = this.connection.grammar
    const bindings: unknown[] = []
    const sql = `DELETE FROM ${g.wrap(this.table)}${this.compileWheres(bindings)}`
    await this.connection.statement(sql, bindings)
  }
}
