import type { Connection } from './connection'

export type Operator = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'like'
type Row = Record<string, unknown>

interface WhereClause {
  boolean: 'AND' | 'OR'
  column: string
  operator: string
  value: unknown
  kind: 'basic' | 'in' | 'null' | 'notNull' | 'between' | 'raw' | 'inSub' | 'exists'
  values?: unknown[]
  rawSql?: string
  sub?: QueryBuilder
}
interface JoinClause {
  type: 'INNER' | 'LEFT'
  table: string
  first: string
  operator: string
  second: string
}

/**
 * Fluent, dialect-agnostic query builder. Accumulates clauses; the connection's
 * grammar renders SQL + bindings, so the same chain runs on SQLite or Postgres.
 * Supports raw fragments (`whereRaw`/`selectRaw`) and subqueries
 * (`whereIn(col, subquery)`, `whereExists`).
 */
export class QueryBuilder {
  private columns = '*'
  private rawSelect?: { sql: string; bindings: unknown[] }
  private distinctFlag = false
  private wheres: WhereClause[] = []
  private joins: JoinClause[] = []
  private groups: string[] = []
  private havings: { sql?: string; column?: string; operator?: string; value?: unknown; bindings?: unknown[] }[] = []
  private orders: { column: string; direction: 'ASC' | 'DESC' }[] = []
  private rawOrders: string[] = []
  private limitValue?: number
  private offsetValue?: number

  constructor(
    private readonly connection: Connection,
    private readonly table: string,
  ) {}

  select(...columns: string[]): this {
    this.columns = columns.length ? columns.map((c) => this.connection.grammar.wrap(c)).join(', ') : '*'
    return this
  }
  /** Raw SELECT expression (use `?` placeholders for bindings). */
  selectRaw(sql: string, bindings: unknown[] = []): this {
    this.rawSelect = { sql, bindings }
    return this
  }
  distinct(): this {
    this.distinctFlag = true
    return this
  }

  where(column: string, operatorOrValue: unknown, value?: unknown): this {
    return this.addWhere('AND', column, operatorOrValue, value)
  }
  orWhere(column: string, operatorOrValue: unknown, value?: unknown): this {
    return this.addWhere('OR', column, operatorOrValue, value)
  }
  /** `whereIn('col', [...])` or `whereIn('col', subquery)`. */
  whereIn(column: string, values: unknown[] | QueryBuilder): this {
    if (values instanceof QueryBuilder) {
      this.wheres.push({ boolean: 'AND', column, operator: 'IN', value: null, kind: 'inSub', sub: values })
    } else {
      this.wheres.push({ boolean: 'AND', column, operator: 'IN', value: null, kind: 'in', values })
    }
    return this
  }
  whereNull(column: string): this {
    this.wheres.push({ boolean: 'AND', column, operator: 'IS NULL', value: null, kind: 'null' })
    return this
  }
  whereNotNull(column: string): this {
    this.wheres.push({ boolean: 'AND', column, operator: 'IS NOT NULL', value: null, kind: 'notNull' })
    return this
  }
  whereBetween(column: string, range: [unknown, unknown]): this {
    this.wheres.push({ boolean: 'AND', column, operator: 'BETWEEN', value: null, kind: 'between', values: range })
    return this
  }
  /** Raw WHERE fragment with `?` placeholders. */
  whereRaw(sql: string, bindings: unknown[] = []): this {
    this.wheres.push({ boolean: 'AND', column: '', operator: '', value: null, kind: 'raw', rawSql: sql, values: bindings })
    return this
  }
  /** `WHERE EXISTS (<subquery>)`. */
  whereExists(sub: QueryBuilder): this {
    this.wheres.push({ boolean: 'AND', column: '', operator: '', value: null, kind: 'exists', sub })
    return this
  }

  join(table: string, first: string, operator: string, second: string): this {
    this.joins.push({ type: 'INNER', table, first, operator, second })
    return this
  }
  leftJoin(table: string, first: string, operator: string, second: string): this {
    this.joins.push({ type: 'LEFT', table, first, operator, second })
    return this
  }

  groupBy(...columns: string[]): this {
    this.groups.push(...columns)
    return this
  }
  having(column: string, operator: string, value: unknown): this {
    this.havings.push({ column, operator, value })
    return this
  }
  havingRaw(sql: string, bindings: unknown[] = []): this {
    this.havings.push({ sql, bindings })
    return this
  }

  orderBy(column: string, direction: 'asc' | 'desc' = 'asc'): this {
    this.orders.push({ column, direction: direction.toUpperCase() as 'ASC' | 'DESC' })
    return this
  }
  orderByRaw(sql: string): this {
    this.rawOrders.push(sql)
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

  private addWhere(boolean: 'AND' | 'OR', column: string, operatorOrValue: unknown, value?: unknown): this {
    const [operator, val] =
      value === undefined ? ['=', operatorOrValue] : [String(operatorOrValue), value]
    this.wheres.push({ boolean, column, operator, value: val, kind: 'basic' })
    return this
  }

  /** Substitute `?` in a raw fragment with dialect placeholders, pushing bindings. */
  private applyRaw(sql: string, rawBindings: unknown[], bindings: unknown[]): string {
    let i = 0
    return sql.replace(/\?/g, () => {
      const ph = this.connection.grammar.placeholder(bindings.length)
      bindings.push(rawBindings[i++])
      return ph
    })
  }

  private compileWheres(bindings: unknown[]): string {
    if (!this.wheres.length) return ''
    const g = this.connection.grammar
    const parts = this.wheres.map((w, i) => {
      const prefix = i === 0 ? '' : `${w.boolean} `
      switch (w.kind) {
        case 'null':
        case 'notNull':
          return `${prefix}${g.wrap(w.column)} ${w.operator}`
        case 'between': {
          const a = g.placeholder(bindings.length)
          bindings.push(w.values?.[0])
          const b = g.placeholder(bindings.length)
          bindings.push(w.values?.[1])
          return `${prefix}${g.wrap(w.column)} BETWEEN ${a} AND ${b}`
        }
        case 'in': {
          if (!w.values?.length) return `${prefix}1 = 0`
          const phs = w.values.map((v) => {
            const ph = g.placeholder(bindings.length)
            bindings.push(v)
            return ph
          })
          return `${prefix}${g.wrap(w.column)} IN (${phs.join(', ')})`
        }
        case 'inSub':
          return `${prefix}${g.wrap(w.column)} IN (${(w.sub as QueryBuilder).compileSelect(bindings)})`
        case 'exists':
          return `${prefix}EXISTS (${(w.sub as QueryBuilder).compileSelect(bindings)})`
        case 'raw':
          return `${prefix}${this.applyRaw(w.rawSql as string, w.values ?? [], bindings)}`
        default: {
          const ph = g.placeholder(bindings.length)
          bindings.push(w.value)
          return `${prefix}${g.wrap(w.column)} ${w.operator} ${ph}`
        }
      }
    })
    return ` WHERE ${parts.join(' ')}`
  }

  private compileJoins(): string {
    const g = this.connection.grammar
    return this.joins
      .map((j) => ` ${j.type} JOIN ${g.wrap(j.table)} ON ${g.wrap(j.first)} ${j.operator} ${g.wrap(j.second)}`)
      .join('')
  }
  private compileGroupsHavings(bindings: unknown[]): string {
    const g = this.connection.grammar
    let sql = ''
    if (this.groups.length) sql += ` GROUP BY ${this.groups.map((c) => g.wrap(c)).join(', ')}`
    if (this.havings.length) {
      const parts = this.havings.map((h) => {
        if (h.sql) return this.applyRaw(h.sql, h.bindings ?? [], bindings)
        const ph = g.placeholder(bindings.length)
        bindings.push(h.value)
        return `${g.wrap(h.column as string)} ${h.operator} ${ph}`
      })
      sql += ` HAVING ${parts.join(' AND ')}`
    }
    return sql
  }

  /** Compile the SELECT into the shared `bindings` array (enables subqueries). */
  compileSelect(bindings: unknown[]): string {
    const g = this.connection.grammar
    const cols = this.rawSelect
      ? this.applyRaw(this.rawSelect.sql, this.rawSelect.bindings, bindings)
      : this.columns
    let sql = `SELECT ${this.distinctFlag ? 'DISTINCT ' : ''}${cols} FROM ${g.wrap(this.table)}`
    sql += this.compileJoins()
    sql += this.compileWheres(bindings)
    sql += this.compileGroupsHavings(bindings)
    const orderParts = [
      ...this.orders.map((o) => `${g.wrap(o.column)} ${o.direction}`),
      ...this.rawOrders,
    ]
    if (orderParts.length) sql += ` ORDER BY ${orderParts.join(', ')}`
    if (this.limitValue !== undefined) sql += ` LIMIT ${this.limitValue}`
    if (this.offsetValue !== undefined) sql += ` OFFSET ${this.offsetValue}`
    return sql
  }

  toSql(): { sql: string; bindings: unknown[] } {
    const bindings: unknown[] = []
    return { sql: this.compileSelect(bindings), bindings }
  }

  async get(): Promise<Row[]> {
    const { sql, bindings } = this.toSql()
    return this.connection.select<Row>(sql, bindings)
  }
  async first(): Promise<Row | undefined> {
    const rows = await this.limit(1).get()
    return rows[0]
  }

  private async aggregate(fn: string, column = '*'): Promise<number> {
    const g = this.connection.grammar
    const bindings: unknown[] = []
    const col = column === '*' ? '*' : g.wrap(column)
    const sql =
      `SELECT ${fn}(${col}) AS aggregate FROM ${g.wrap(this.table)}` +
      this.compileJoins() +
      this.compileWheres(bindings) +
      this.compileGroupsHavings(bindings)
    const rows = await this.connection.select<{ aggregate: number | string }>(sql, bindings)
    return Number(rows[0]?.aggregate ?? 0)
  }
  count(): Promise<number> {
    return this.aggregate('COUNT')
  }
  sum(column: string): Promise<number> {
    return this.aggregate('SUM', column)
  }
  avg(column: string): Promise<number> {
    return this.aggregate('AVG', column)
  }
  min(column: string): Promise<number> {
    return this.aggregate('MIN', column)
  }
  max(column: string): Promise<number> {
    return this.aggregate('MAX', column)
  }
  async exists(): Promise<boolean> {
    return (await this.count()) > 0
  }

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

  private async crement(sign: '+' | '-', column: string, amount: number, extra: Row): Promise<void> {
    const g = this.connection.grammar
    const bindings: unknown[] = []
    const amountPh = g.placeholder(bindings.length)
    bindings.push(amount)
    const sets = [`${g.wrap(column)} = ${g.wrap(column)} ${sign} ${amountPh}`]
    for (const [col, val] of Object.entries(extra)) {
      const ph = g.placeholder(bindings.length)
      bindings.push(val)
      sets.push(`${g.wrap(col)} = ${ph}`)
    }
    const sql = `UPDATE ${g.wrap(this.table)} SET ${sets.join(', ')}${this.compileWheres(bindings)}`
    await this.connection.statement(sql, bindings)
  }
  increment(column: string, amount = 1, extra: Row = {}): Promise<void> {
    return this.crement('+', column, amount, extra)
  }
  decrement(column: string, amount = 1, extra: Row = {}): Promise<void> {
    return this.crement('-', column, amount, extra)
  }

  async delete(): Promise<void> {
    const g = this.connection.grammar
    const bindings: unknown[] = []
    const sql = `DELETE FROM ${g.wrap(this.table)}${this.compileWheres(bindings)}`
    await this.connection.statement(sql, bindings)
  }

  async upsert(rows: Row[], uniqueBy: string[], update: string[]): Promise<void> {
    if (rows.length === 0) return
    const g = this.connection.grammar
    const columns = Object.keys(rows[0] as Row)
    const bindings: unknown[] = []
    const tuples = rows.map((row) => {
      const phs = columns.map((c) => {
        const ph = g.placeholder(bindings.length)
        bindings.push((row as Row)[c])
        return ph
      })
      return `(${phs.join(', ')})`
    })
    const conflict = uniqueBy.map((c) => g.wrap(c)).join(', ')
    const setClause = update.map((c) => `${g.wrap(c)} = excluded.${g.wrap(c)}`).join(', ')
    const sql =
      `INSERT INTO ${g.wrap(this.table)} (${columns.map((c) => g.wrap(c)).join(', ')}) VALUES ${tuples.join(', ')}` +
      ` ON CONFLICT (${conflict}) DO UPDATE SET ${setClause}`
    await this.connection.statement(sql, bindings)
  }

  async chunk(size: number, callback: (rows: Row[]) => void | Promise<void>): Promise<void> {
    let page = 0
    while (true) {
      const rows = await this.offset(page * size).limit(size).get()
      if (rows.length === 0) break
      await callback(rows)
      if (rows.length < size) break
      page++
    }
  }
}
