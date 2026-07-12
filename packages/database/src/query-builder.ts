import { LazyCollection } from '@elysia-ravel/support'
import { type Connection, useConnection } from './connection'

export type Operator = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'like'
type Row = Record<string, unknown>
type Bool = 'AND' | 'OR'

/** Length-aware page of raw rows. */
export interface RowPaginator {
  data: Row[]
  total: number
  perPage: number
  currentPage: number
  lastPage: number
}
/** Page without a COUNT — just "is there more?". */
export interface SimpleRowPaginator {
  data: Row[]
  perPage: number
  currentPage: number
  hasMore: boolean
}
/** Keyset page. */
export interface CursorRowPaginator {
  data: Row[]
  perPage: number
  nextCursor: unknown
}

type DatePart = 'date' | 'year' | 'month' | 'day' | 'time'

interface WhereClause {
  boolean: Bool
  column: string
  operator: string
  value: unknown
  kind:
    | 'basic'
    | 'in'
    | 'notIn'
    | 'null'
    | 'notNull'
    | 'between'
    | 'notBetween'
    | 'betweenColumns'
    | 'notBetweenColumns'
    | 'raw'
    | 'inSub'
    | 'sub'
    | 'exists'
    | 'notExists'
    | 'group'
    | 'not'
    | 'column'
    | 'datePart'
    | 'jsonContains'
  values?: unknown[]
  rawSql?: string
  sub?: QueryBuilder
  secondColumn?: string
  part?: DatePart
}

type JoinTable = string | { sub: QueryBuilder; alias: string }
interface JoinCond {
  boolean: Bool
  first: string
  operator: string
  second?: string
  value?: unknown
  isValue: boolean
}
interface JoinClause {
  type: 'INNER' | 'LEFT' | 'RIGHT' | 'CROSS'
  table: JoinTable
  conditions: JoinCond[]
}

type SelectPart =
  | { kind: 'col'; col: string }
  | { kind: 'raw'; sql: string; bindings: unknown[] }
  | { kind: 'sub'; sub: QueryBuilder; alias: string }

interface UnionClause {
  query: QueryBuilder
  all: boolean
}

/** Builder passed to a join closure: `join('t', (j) => j.on(a,'=',b).orOn(...))`. */
export class JoinClauseBuilder {
  readonly conditions: JoinCond[] = []
  on(first: string, operator: string, second: string): this {
    this.conditions.push({ boolean: 'AND', first, operator, second, isValue: false })
    return this
  }
  orOn(first: string, operator: string, second: string): this {
    this.conditions.push({ boolean: 'OR', first, operator, second, isValue: false })
    return this
  }
  where(column: string, operator: string, value: unknown): this {
    this.conditions.push({ boolean: 'AND', first: column, operator, value, isValue: true })
    return this
  }
  orWhere(column: string, operator: string, value: unknown): this {
    this.conditions.push({ boolean: 'OR', first: column, operator, value, isValue: true })
    return this
  }
}

/**
 * Fluent, dialect-agnostic query builder. Accumulates clauses; the connection's
 * grammar renders SQL + bindings, so the same chain runs on SQLite or Postgres.
 * Supports raw fragments (`whereRaw`/`selectRaw`) and subqueries throughout
 * (`select`/`from`/`join`/`where`/`whereIn`/`whereExists`).
 */
export class QueryBuilder {
  private selects: SelectPart[] = []
  private distinctFlag = false
  private fromSubq?: { sub: QueryBuilder; alias: string }
  private wheres: WhereClause[] = []
  private joins: JoinClause[] = []
  private groups: string[] = []
  private rawGroups: string[] = []
  private havings: {
    sql?: string
    column?: string
    operator?: string
    value?: unknown
    bindings?: unknown[]
    between?: [unknown, unknown]
    boolean: Bool
  }[] = []
  private orders: { column: string; direction: 'ASC' | 'DESC' }[] = []
  private rawOrders: string[] = []
  private limitValue?: number
  private offsetValue?: number
  private unions: UnionClause[] = []
  private lock?: string

  constructor(
    private readonly connection: Connection,
    private readonly table: string,
  ) {}

  // ── SELECT ────────────────────────────────────────────────────────────────
  select(...columns: string[]): this {
    this.selects = columns.map((col) => ({ kind: 'col', col }))
    return this
  }
  addSelect(...columns: string[]): this {
    for (const col of columns) this.selects.push({ kind: 'col', col })
    return this
  }
  /** Raw SELECT expression (use `?` placeholders for bindings). */
  selectRaw(sql: string, bindings: unknown[] = []): this {
    this.selects.push({ kind: 'raw', sql, bindings })
    return this
  }
  /** Select a subquery as a column: `SELECT (<sub>) AS alias`. */
  selectSub(sub: QueryBuilder, alias: string): this {
    this.selects.push({ kind: 'sub', sub, alias })
    return this
  }
  distinct(): this {
    this.distinctFlag = true
    return this
  }
  /** Query a subquery as the FROM source: `FROM (<sub>) AS alias`. */
  fromSub(sub: QueryBuilder, alias: string): this {
    this.fromSubq = { sub, alias }
    return this
  }

  // ── WHERE ───────────────────────────────────────────────────────────────
  where(
    column: string | ((q: QueryBuilder) => void),
    operatorOrValue?: unknown,
    value?: unknown,
  ): this {
    if (typeof column === 'function') return this.whereGroup('AND', column)
    return this.addWhere('AND', column, operatorOrValue, value)
  }
  orWhere(
    column: string | ((q: QueryBuilder) => void),
    operatorOrValue?: unknown,
    value?: unknown,
  ): this {
    if (typeof column === 'function') return this.whereGroup('OR', column)
    return this.addWhere('OR', column, operatorOrValue, value)
  }
  /** Negate a group or a single condition: `whereNot((q) => ...)` / `whereNot(col, op, val)`. */
  whereNot(
    column: string | ((q: QueryBuilder) => void),
    operatorOrValue?: unknown,
    value?: unknown,
  ): this {
    return this.addNot('AND', column, operatorOrValue, value)
  }
  orWhereNot(
    column: string | ((q: QueryBuilder) => void),
    operatorOrValue?: unknown,
    value?: unknown,
  ): this {
    return this.addNot('OR', column, operatorOrValue, value)
  }
  private addNot(
    boolean: Bool,
    column: string | ((q: QueryBuilder) => void),
    operatorOrValue?: unknown,
    value?: unknown,
  ): this {
    const sub = this.newQuery()
    if (typeof column === 'function') column(sub)
    else sub.addWhere('AND', column, operatorOrValue, value)
    this.wheres.push({ boolean, column: '', operator: '', value: null, kind: 'not', sub })
    return this
  }
  private whereGroup(boolean: Bool, build: (q: QueryBuilder) => void): this {
    const sub = this.newQuery()
    build(sub)
    this.wheres.push({ boolean, column: '', operator: '', value: null, kind: 'group', sub })
    return this
  }
  whereColumn(first: string, operator: string, second: string): this {
    this.wheres.push({
      boolean: 'AND',
      column: first,
      operator,
      value: null,
      kind: 'column',
      secondColumn: second,
    })
    return this
  }
  orWhereColumn(first: string, operator: string, second: string): this {
    this.wheres.push({
      boolean: 'OR',
      column: first,
      operator,
      value: null,
      kind: 'column',
      secondColumn: second,
    })
    return this
  }
  whereNotIn(column: string, values: unknown[]): this {
    this.wheres.push({ boolean: 'AND', column, operator: 'NOT IN', value: null, kind: 'notIn', values })
    return this
  }
  orWhereIn(column: string, values: unknown[]): this {
    this.wheres.push({ boolean: 'OR', column, operator: 'IN', value: null, kind: 'in', values })
    return this
  }
  orWhereNotIn(column: string, values: unknown[]): this {
    this.wheres.push({ boolean: 'OR', column, operator: 'NOT IN', value: null, kind: 'notIn', values })
    return this
  }
  whereBetween(column: string, range: [unknown, unknown]): this {
    this.wheres.push({ boolean: 'AND', column, operator: '', value: null, kind: 'between', values: range })
    return this
  }
  whereNotBetween(column: string, range: [unknown, unknown]): this {
    this.wheres.push({ boolean: 'AND', column, operator: '', value: null, kind: 'notBetween', values: range })
    return this
  }
  /** `col BETWEEN <col1> AND <col2>` (column bounds, not values). */
  whereBetweenColumns(column: string, columns: [string, string]): this {
    this.wheres.push({
      boolean: 'AND',
      column,
      operator: '',
      value: null,
      kind: 'betweenColumns',
      values: columns,
    })
    return this
  }
  whereNotBetweenColumns(column: string, columns: [string, string]): this {
    this.wheres.push({
      boolean: 'AND',
      column,
      operator: '',
      value: null,
      kind: 'notBetweenColumns',
      values: columns,
    })
    return this
  }
  /** Conditionally apply clauses: `when(active, (q) => q.where('active', 1))`. */
  when(condition: unknown, then: (q: this) => void, otherwise?: (q: this) => void): this {
    if (condition) then(this)
    else otherwise?.(this)
    return this
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
  orWhereNull(column: string): this {
    this.wheres.push({ boolean: 'OR', column, operator: 'IS NULL', value: null, kind: 'null' })
    return this
  }
  whereNotNull(column: string): this {
    this.wheres.push({ boolean: 'AND', column, operator: 'IS NOT NULL', value: null, kind: 'notNull' })
    return this
  }
  orWhereNotNull(column: string): this {
    this.wheres.push({ boolean: 'OR', column, operator: 'IS NOT NULL', value: null, kind: 'notNull' })
    return this
  }
  /** Case-insensitive LIKE (`ILIKE` on Postgres). */
  whereLike(column: string, value: string): this {
    return this.addLike('AND', column, value)
  }
  orWhereLike(column: string, value: string): this {
    return this.addLike('OR', column, value)
  }
  private addLike(boolean: Bool, column: string, value: string): this {
    const op = this.connection.dialect === 'pg' ? 'ILIKE' : 'LIKE'
    this.wheres.push({ boolean, column, operator: op, value, kind: 'basic' })
    return this
  }
  whereDate(column: string, operatorOrValue: unknown, value?: unknown): this {
    return this.addDatePart('AND', 'date', column, operatorOrValue, value)
  }
  whereYear(column: string, operatorOrValue: unknown, value?: unknown): this {
    return this.addDatePart('AND', 'year', column, operatorOrValue, value)
  }
  whereMonth(column: string, operatorOrValue: unknown, value?: unknown): this {
    return this.addDatePart('AND', 'month', column, operatorOrValue, value)
  }
  whereDay(column: string, operatorOrValue: unknown, value?: unknown): this {
    return this.addDatePart('AND', 'day', column, operatorOrValue, value)
  }
  whereTime(column: string, operatorOrValue: unknown, value?: unknown): this {
    return this.addDatePart('AND', 'time', column, operatorOrValue, value)
  }
  private addDatePart(
    boolean: Bool,
    part: DatePart,
    column: string,
    operatorOrValue: unknown,
    value?: unknown,
  ): this {
    const [operator, val] =
      value === undefined ? ['=', operatorOrValue] : [String(operatorOrValue), value]
    this.wheres.push({ boolean, column, operator, value: val, kind: 'datePart', part })
    return this
  }
  /** Whether a JSON column contains `value` (best-effort, dialect-specific). */
  whereJsonContains(column: string, value: unknown): this {
    this.wheres.push({ boolean: 'AND', column, operator: '', value, kind: 'jsonContains' })
    return this
  }
  /** Raw WHERE fragment with `?` placeholders. */
  whereRaw(sql: string, bindings: unknown[] = []): this {
    this.wheres.push({ boolean: 'AND', column: '', operator: '', value: null, kind: 'raw', rawSql: sql, values: bindings })
    return this
  }
  orWhereRaw(sql: string, bindings: unknown[] = []): this {
    this.wheres.push({ boolean: 'OR', column: '', operator: '', value: null, kind: 'raw', rawSql: sql, values: bindings })
    return this
  }
  /** `WHERE EXISTS (<subquery>)`. */
  whereExists(sub: QueryBuilder): this {
    this.wheres.push({ boolean: 'AND', column: '', operator: '', value: null, kind: 'exists', sub })
    return this
  }
  whereNotExists(sub: QueryBuilder): this {
    this.wheres.push({ boolean: 'AND', column: '', operator: '', value: null, kind: 'notExists', sub })
    return this
  }

  // ── JOIN ────────────────────────────────────────────────────────────────
  join(
    table: JoinTable,
    first: string | ((j: JoinClauseBuilder) => void),
    operator?: string,
    second?: string,
  ): this {
    return this.addJoin('INNER', table, first, operator, second)
  }
  leftJoin(
    table: JoinTable,
    first: string | ((j: JoinClauseBuilder) => void),
    operator?: string,
    second?: string,
  ): this {
    return this.addJoin('LEFT', table, first, operator, second)
  }
  rightJoin(
    table: JoinTable,
    first: string | ((j: JoinClauseBuilder) => void),
    operator?: string,
    second?: string,
  ): this {
    return this.addJoin('RIGHT', table, first, operator, second)
  }
  crossJoin(table: JoinTable): this {
    this.joins.push({ type: 'CROSS', table, conditions: [] })
    return this
  }
  /** Join a subquery: `joinSub(sub, 'alias', 'alias.x', '=', 'y')`. */
  joinSub(sub: QueryBuilder, alias: string, first: string, operator: string, second: string): this {
    return this.addJoin('INNER', { sub, alias }, first, operator, second)
  }
  private addJoin(
    type: JoinClause['type'],
    table: JoinTable,
    first: string | ((j: JoinClauseBuilder) => void),
    operator?: string,
    second?: string,
  ): this {
    if (typeof first === 'function') {
      const builder = new JoinClauseBuilder()
      first(builder)
      this.joins.push({ type, table, conditions: builder.conditions })
    } else {
      this.joins.push({
        type,
        table,
        conditions: [{ boolean: 'AND', first, operator: operator as string, second, isValue: false }],
      })
    }
    return this
  }

  // ── GROUP / HAVING / ORDER / LIMIT ────────────────────────────────────────
  groupBy(...columns: string[]): this {
    this.groups.push(...columns)
    return this
  }
  groupByRaw(sql: string): this {
    this.rawGroups.push(sql)
    return this
  }
  having(column: string, operator: string, value: unknown): this {
    this.havings.push({ column, operator, value, boolean: 'AND' })
    return this
  }
  havingBetween(column: string, range: [unknown, unknown]): this {
    this.havings.push({ column, between: range, boolean: 'AND' })
    return this
  }
  havingRaw(sql: string, bindings: unknown[] = []): this {
    this.havings.push({ sql, bindings, boolean: 'AND' })
    return this
  }
  orderBy(column: string, direction: 'asc' | 'desc' = 'asc'): this {
    this.orders.push({ column, direction: direction.toUpperCase() as 'ASC' | 'DESC' })
    return this
  }
  orderByDesc(column: string): this {
    return this.orderBy(column, 'desc')
  }
  latest(column = 'created_at'): this {
    return this.orderBy(column, 'desc')
  }
  oldest(column = 'created_at'): this {
    return this.orderBy(column, 'asc')
  }
  orderByRaw(sql: string): this {
    this.rawOrders.push(sql)
    return this
  }
  inRandomOrder(): this {
    this.rawOrders.push('RANDOM()')
    return this
  }
  /** Drop all orderings (optionally set a new one). */
  reorder(column?: string, direction: 'asc' | 'desc' = 'asc'): this {
    this.orders = []
    this.rawOrders = []
    if (column) this.orderBy(column, direction)
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
  take(n: number): this {
    return this.limit(n)
  }
  skip(n: number): this {
    return this.offset(n)
  }
  forPage(page: number, perPage = 15): this {
    return this.offset((page - 1) * perPage).limit(perPage)
  }
  /** Append `UNION <other select>`. */
  union(other: QueryBuilder): this {
    this.unions.push({ query: other, all: false })
    return this
  }
  unionAll(other: QueryBuilder): this {
    this.unions.push({ query: other, all: true })
    return this
  }
  /** `FOR UPDATE` (Postgres; no-op on SQLite). */
  lockForUpdate(): this {
    this.lock = 'FOR UPDATE'
    return this
  }
  /** `FOR SHARE` (Postgres; no-op on SQLite). */
  sharedLock(): this {
    this.lock = 'FOR SHARE'
    return this
  }

  private addWhere(boolean: Bool, column: string, operatorOrValue: unknown, value?: unknown): this {
    const [operator, val] =
      value === undefined ? ['=', operatorOrValue] : [String(operatorOrValue), value]
    if (val instanceof QueryBuilder) {
      this.wheres.push({ boolean, column, operator, value: null, kind: 'sub', sub: val })
    } else {
      this.wheres.push({ boolean, column, operator, value: val, kind: 'basic' })
    }
    return this
  }

  private newQuery(): QueryBuilder {
    return new QueryBuilder(this.connection, this.table)
  }

  // ── compilation ───────────────────────────────────────────────────────────
  /** Substitute `?` in a raw fragment with dialect placeholders, pushing bindings. */
  private applyRaw(sql: string, rawBindings: unknown[], bindings: unknown[]): string {
    let i = 0
    return sql.replace(/\?/g, () => {
      const ph = this.connection.grammar.placeholder(bindings.length)
      bindings.push(rawBindings[i++])
      return ph
    })
  }

  private bind(value: unknown, bindings: unknown[]): string {
    const ph = this.connection.grammar.placeholder(bindings.length)
    bindings.push(value)
    return ph
  }

  private datePartSql(w: WhereClause, bindings: unknown[]): string {
    const g = this.connection.grammar
    const col = g.wrap(w.column)
    const ph = this.bind(w.value, bindings)
    const pg = this.connection.dialect === 'pg'
    // On pg our date columns are TEXT (cross-dialect ISO strings), so cast before extract.
    const ts = `${col}::timestamp`
    switch (w.part) {
      case 'date':
        return `${pg ? `${col}::date` : `date(${col})`} ${w.operator} ${ph}`
      case 'time':
        return `${pg ? `${col}::time` : `strftime('%H:%M:%S', ${col})`} ${w.operator} ${ph}`
      case 'year':
        return `${pg ? `extract(year from ${ts})` : `cast(strftime('%Y', ${col}) as integer)`} ${w.operator} ${ph}`
      case 'month':
        return `${pg ? `extract(month from ${ts})` : `cast(strftime('%m', ${col}) as integer)`} ${w.operator} ${ph}`
      default: // day
        return `${pg ? `extract(day from ${ts})` : `cast(strftime('%d', ${col}) as integer)`} ${w.operator} ${ph}`
    }
  }

  private jsonContainsSql(w: WhereClause, bindings: unknown[]): string {
    const g = this.connection.grammar
    const col = g.wrap(w.column)
    if (this.connection.dialect === 'pg') {
      const ph = this.bind(JSON.stringify(w.value), bindings)
      return `${col} @> ${ph}::jsonb`
    }
    const ph = this.bind(w.value, bindings)
    return `EXISTS (SELECT 1 FROM json_each(${col}) WHERE json_each.value = ${ph})`
  }

  compileWhereConditions(bindings: unknown[]): string {
    const g = this.connection.grammar
    const between = (w: WhereClause, keyword: string) =>
      `${g.wrap(w.column)} ${keyword} ${this.bind(w.values?.[0], bindings)} AND ${this.bind(w.values?.[1], bindings)}`
    const betweenCols = (w: WhereClause, keyword: string) =>
      `${g.wrap(w.column)} ${keyword} ${g.wrap(String(w.values?.[0]))} AND ${g.wrap(String(w.values?.[1]))}`
    const inList = (w: WhereClause, keyword: string, emptyResult: string) => {
      if (!w.values?.length) return emptyResult
      return `${g.wrap(w.column)} ${keyword} (${w.values.map((v) => this.bind(v, bindings)).join(', ')})`
    }
    return this.wheres
      .map((w, i) => {
        const prefix = i === 0 ? '' : `${w.boolean} `
        switch (w.kind) {
          case 'null':
          case 'notNull':
            return `${prefix}${g.wrap(w.column)} ${w.operator}`
          case 'between':
            return `${prefix}${between(w, 'BETWEEN')}`
          case 'notBetween':
            return `${prefix}${between(w, 'NOT BETWEEN')}`
          case 'betweenColumns':
            return `${prefix}${betweenCols(w, 'BETWEEN')}`
          case 'notBetweenColumns':
            return `${prefix}${betweenCols(w, 'NOT BETWEEN')}`
          case 'in':
            return `${prefix}${inList(w, 'IN', '1 = 0')}`
          case 'notIn':
            return `${prefix}${inList(w, 'NOT IN', '1 = 1')}`
          case 'inSub':
            return `${prefix}${g.wrap(w.column)} IN (${(w.sub as QueryBuilder).compileSelect(bindings)})`
          case 'sub':
            return `${prefix}${g.wrap(w.column)} ${w.operator} (${(w.sub as QueryBuilder).compileSelect(bindings)})`
          case 'exists':
            return `${prefix}EXISTS (${(w.sub as QueryBuilder).compileSelect(bindings)})`
          case 'notExists':
            return `${prefix}NOT EXISTS (${(w.sub as QueryBuilder).compileSelect(bindings)})`
          case 'group':
            return `${prefix}(${(w.sub as QueryBuilder).compileWhereConditions(bindings)})`
          case 'not':
            return `${prefix}NOT (${(w.sub as QueryBuilder).compileWhereConditions(bindings)})`
          case 'column':
            return `${prefix}${g.wrap(w.column)} ${w.operator} ${g.wrap(w.secondColumn as string)}`
          case 'datePart':
            return `${prefix}${this.datePartSql(w, bindings)}`
          case 'jsonContains':
            return `${prefix}${this.jsonContainsSql(w, bindings)}`
          case 'raw':
            return `${prefix}${this.applyRaw(w.rawSql as string, w.values ?? [], bindings)}`
          default:
            return `${prefix}${g.wrap(w.column)} ${w.operator} ${this.bind(w.value, bindings)}`
        }
      })
      .join(' ')
  }

  private compileWheres(bindings: unknown[]): string {
    return this.wheres.length ? ` WHERE ${this.compileWhereConditions(bindings)}` : ''
  }

  private compileFrom(bindings: unknown[]): string {
    const g = this.connection.grammar
    if (this.fromSubq) {
      return `(${this.fromSubq.sub.compileSelect(bindings)}) AS ${g.wrap(this.fromSubq.alias)}`
    }
    return g.wrap(this.table)
  }

  private compileJoinTable(table: JoinTable, bindings: unknown[]): string {
    const g = this.connection.grammar
    if (typeof table === 'string') return g.wrap(table)
    return `(${table.sub.compileSelect(bindings)}) AS ${g.wrap(table.alias)}`
  }

  private compileJoins(bindings: unknown[]): string {
    const g = this.connection.grammar
    return this.joins
      .map((j) => {
        const target = this.compileJoinTable(j.table, bindings)
        if (j.type === 'CROSS') return ` CROSS JOIN ${target}`
        const on = j.conditions
          .map((c, i) => {
            const prefix = i === 0 ? '' : `${c.boolean} `
            const rhs = c.isValue ? this.bind(c.value, bindings) : g.wrap(c.second as string)
            return `${prefix}${g.wrap(c.first)} ${c.operator} ${rhs}`
          })
          .join(' ')
        return ` ${j.type} JOIN ${target} ON ${on}`
      })
      .join('')
  }

  private compileGroupsHavings(bindings: unknown[]): string {
    const g = this.connection.grammar
    let sql = ''
    const groups = [...this.groups.map((c) => g.wrap(c)), ...this.rawGroups]
    if (groups.length) sql += ` GROUP BY ${groups.join(', ')}`
    if (this.havings.length) {
      const parts = this.havings.map((h) => {
        if (h.sql) return this.applyRaw(h.sql, h.bindings ?? [], bindings)
        if (h.between) {
          return `${g.wrap(h.column as string)} BETWEEN ${this.bind(h.between[0], bindings)} AND ${this.bind(h.between[1], bindings)}`
        }
        return `${g.wrap(h.column as string)} ${h.operator} ${this.bind(h.value, bindings)}`
      })
      sql += ` HAVING ${parts.join(' AND ')}`
    }
    return sql
  }

  private compileColumns(bindings: unknown[]): string {
    if (this.selects.length === 0) return '*'
    const g = this.connection.grammar
    return this.selects
      .map((s) => {
        if (s.kind === 'col') return g.wrap(s.col)
        if (s.kind === 'raw') return this.applyRaw(s.sql, s.bindings, bindings)
        return `(${s.sub.compileSelect(bindings)}) AS ${g.wrap(s.alias)}`
      })
      .join(', ')
  }

  /** Compile the SELECT into the shared `bindings` array (enables subqueries). */
  compileSelect(bindings: unknown[]): string {
    const g = this.connection.grammar
    let sql = `SELECT ${this.distinctFlag ? 'DISTINCT ' : ''}${this.compileColumns(bindings)}`
    sql += ` FROM ${this.compileFrom(bindings)}`
    sql += this.compileJoins(bindings)
    sql += this.compileWheres(bindings)
    sql += this.compileGroupsHavings(bindings)
    const orderParts = [
      ...this.orders.map((o) => `${g.wrap(o.column)} ${o.direction}`),
      ...this.rawOrders,
    ]
    if (orderParts.length) sql += ` ORDER BY ${orderParts.join(', ')}`
    if (this.limitValue !== undefined) sql += ` LIMIT ${this.limitValue}`
    if (this.offsetValue !== undefined) sql += ` OFFSET ${this.offsetValue}`
    for (const u of this.unions) sql += ` UNION ${u.all ? 'ALL ' : ''}${u.query.compileSelect(bindings)}`
    if (this.lock && this.connection.dialect === 'pg') sql += ` ${this.lock}`
    return sql
  }

  toSql(): { sql: string; bindings: unknown[] } {
    const bindings: unknown[] = []
    return { sql: this.compileSelect(bindings), bindings }
  }

  /** Deep-ish copy for pagination/keyset iteration (does not clone sub-builders). */
  private clone(): QueryBuilder {
    const q = new QueryBuilder(this.connection, this.table)
    q.selects = [...this.selects]
    q.distinctFlag = this.distinctFlag
    q.fromSubq = this.fromSubq
    q.wheres = [...this.wheres]
    q.joins = [...this.joins]
    q.groups = [...this.groups]
    q.rawGroups = [...this.rawGroups]
    q.havings = [...this.havings]
    q.orders = [...this.orders]
    q.rawOrders = [...this.rawOrders]
    q.limitValue = this.limitValue
    q.offsetValue = this.offsetValue
    q.unions = [...this.unions]
    q.lock = this.lock
    return q
  }

  // ── terminals ─────────────────────────────────────────────────────────────
  async get(): Promise<Row[]> {
    const { sql, bindings } = this.toSql()
    return this.connection.select<Row>(sql, bindings)
  }
  async first(): Promise<Row | undefined> {
    const rows = await this.limit(1).get()
    return rows[0]
  }
  /** Find a row by primary key. */
  async find(id: unknown, column = 'id'): Promise<Row | undefined> {
    return this.where(column, id).first()
  }

  private async aggregate(fn: string, column = '*'): Promise<number> {
    const g = this.connection.grammar
    const bindings: unknown[] = []
    const col = column === '*' ? '*' : g.wrap(column)
    const sql =
      `SELECT ${fn}(${col}) AS aggregate FROM ${this.compileFrom(bindings)}` +
      this.compileJoins(bindings) +
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
    return (await this.clone().count()) > 0
  }
  async doesntExist(): Promise<boolean> {
    return !(await this.exists())
  }

  // ── pagination ──────────────────────────────────────────────────────────
  async paginate(perPage = 15, page = 1): Promise<RowPaginator> {
    const total = await this.clone().count()
    const data = await this.clone().forPage(page, perPage).get()
    return { data, total, perPage, currentPage: page, lastPage: Math.max(1, Math.ceil(total / perPage)) }
  }
  async simplePaginate(perPage = 15, page = 1): Promise<SimpleRowPaginator> {
    const rows = await this.clone()
      .offset((page - 1) * perPage)
      .limit(perPage + 1)
      .get()
    const hasMore = rows.length > perPage
    return { data: hasMore ? rows.slice(0, perPage) : rows, perPage, currentPage: page, hasMore }
  }
  async cursorPaginate(
    perPage = 15,
    cursor?: unknown,
    column = 'id',
  ): Promise<CursorRowPaginator> {
    const q = this.clone()
    if (cursor !== undefined) q.where(column, '>', cursor)
    const rows = await q.orderBy(column, 'asc').limit(perPage + 1).get()
    const hasMore = rows.length > perPage
    const data = hasMore ? rows.slice(0, perPage) : rows
    const nextCursor = hasMore ? data[data.length - 1]?.[column] : undefined
    return { data, perPage, nextCursor }
  }

  // ── lazy iteration ────────────────────────────────────────────────────────
  async chunk(size: number, callback: (rows: Row[]) => void | Promise<void>): Promise<void> {
    let page = 0
    while (true) {
      const rows = await this.clone().offset(page * size).limit(size).get()
      if (rows.length === 0) break
      await callback(rows)
      if (rows.length < size) break
      page++
    }
  }
  /** Keyset chunking — safe when the callback mutates matched rows. */
  async chunkById(
    size: number,
    callback: (rows: Row[]) => void | Promise<void>,
    column = 'id',
  ): Promise<void> {
    let lastId: unknown
    while (true) {
      const q = this.clone().reorder(column, 'asc').limit(size)
      if (lastId !== undefined) q.where(column, '>', lastId)
      const rows = await q.get()
      if (rows.length === 0) break
      await callback(rows)
      lastId = rows[rows.length - 1]?.[column]
      if (rows.length < size) break
    }
  }
  /** Stream rows lazily in id-keyset chunks as a LazyCollection. */
  cursor(size = 1000, column = 'id'): LazyCollection<Row> {
    const self = this
    return new LazyCollection<Row>(async function* () {
      let lastId: unknown
      while (true) {
        const q = self.clone().reorder(column, 'asc').limit(size)
        if (lastId !== undefined) q.where(column, '>', lastId)
        const rows = await q.get()
        if (rows.length === 0) break
        for (const row of rows) yield row
        lastId = rows[rows.length - 1]?.[column]
        if (rows.length < size) break
      }
    })
  }
  lazy(size = 1000, column = 'id'): LazyCollection<Row> {
    return this.cursor(size, column)
  }

  /** First row's single column value. */
  async value<T = unknown>(column: string): Promise<T | undefined> {
    const row = await this.select(column).first()
    return row?.[column] as T | undefined
  }
  /** Array of a single column's values. */
  async pluck<T = unknown>(column: string): Promise<T[]> {
    const rows = await this.select(column).get()
    return rows.map((r) => r[column] as T)
  }

  // ── writes ────────────────────────────────────────────────────────────────
  async insert(values: Row): Promise<Row> {
    const g = this.connection.grammar
    const columns = Object.keys(values)
    if (columns.length === 0) {
      const rows = await this.connection.select<Row>(
        `INSERT INTO ${g.wrap(this.table)} DEFAULT VALUES RETURNING *`,
      )
      return rows[0] as Row
    }
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
    const sets = Object.entries(values).map(([col, val]) => `${g.wrap(col)} = ${this.bind(val, bindings)}`)
    const sql = `UPDATE ${g.wrap(this.table)} SET ${sets.join(', ')}${this.compileWheres(bindings)}`
    await this.connection.statement(sql, bindings)
  }

  private async crement(
    changes: Record<string, { sign: '+' | '-'; amount: number }>,
    extra: Row,
  ): Promise<void> {
    const g = this.connection.grammar
    const bindings: unknown[] = []
    const sets = Object.entries(changes).map(
      ([col, { sign, amount }]) => `${g.wrap(col)} = ${g.wrap(col)} ${sign} ${this.bind(amount, bindings)}`,
    )
    for (const [col, val] of Object.entries(extra)) sets.push(`${g.wrap(col)} = ${this.bind(val, bindings)}`)
    const sql = `UPDATE ${g.wrap(this.table)} SET ${sets.join(', ')}${this.compileWheres(bindings)}`
    await this.connection.statement(sql, bindings)
  }
  increment(column: string, amount = 1, extra: Row = {}): Promise<void> {
    return this.crement({ [column]: { sign: '+', amount } }, extra)
  }
  decrement(column: string, amount = 1, extra: Row = {}): Promise<void> {
    return this.crement({ [column]: { sign: '-', amount } }, extra)
  }
  /** Increment several columns at once. */
  incrementEach(columns: Record<string, number>, extra: Row = {}): Promise<void> {
    const changes: Record<string, { sign: '+' | '-'; amount: number }> = {}
    for (const [col, amount] of Object.entries(columns)) {
      changes[col] = { sign: amount < 0 ? '-' : '+', amount: Math.abs(amount) }
    }
    return this.crement(changes, extra)
  }

  async delete(): Promise<void> {
    const g = this.connection.grammar
    const bindings: unknown[] = []
    const sql = `DELETE FROM ${g.wrap(this.table)}${this.compileWheres(bindings)}`
    await this.connection.statement(sql, bindings)
  }

  /** Empty the table. Uses TRUNCATE on Postgres, DELETE on SQLite. */
  async truncate(): Promise<void> {
    const g = this.connection.grammar
    if (this.connection.dialect === 'pg') {
      await this.connection.statement(`TRUNCATE TABLE ${g.wrap(this.table)} RESTART IDENTITY CASCADE`)
    } else {
      await this.connection.statement(`DELETE FROM ${g.wrap(this.table)}`)
      await this.connection.statement(`DELETE FROM sqlite_sequence WHERE name = ?`, [this.table])
    }
  }

  async upsert(rows: Row[], uniqueBy: string[], update: string[]): Promise<void> {
    if (rows.length === 0) return
    const g = this.connection.grammar
    const columns = Object.keys(rows[0] as Row)
    const bindings: unknown[] = []
    const tuples = rows.map((row) => `(${columns.map((c) => this.bind((row as Row)[c], bindings)).join(', ')})`)
    const conflict = uniqueBy.map((c) => g.wrap(c)).join(', ')
    const setClause = update.map((c) => `${g.wrap(c)} = excluded.${g.wrap(c)}`).join(', ')
    const sql =
      `INSERT INTO ${g.wrap(this.table)} (${columns.map((c) => g.wrap(c)).join(', ')}) VALUES ${tuples.join(', ')}` +
      ` ON CONFLICT (${conflict}) DO UPDATE SET ${setClause}`
    await this.connection.statement(sql, bindings)
  }

  private valueTuples(rows: Row[], columns: string[], bindings: unknown[]): string {
    return rows.map((row) => `(${columns.map((c) => this.bind(row[c], bindings)).join(', ')})`).join(', ')
  }

  /** Insert multiple rows in one statement. */
  async insertMany(rows: Row[]): Promise<void> {
    if (rows.length === 0) return
    const g = this.connection.grammar
    const columns = Object.keys(rows[0] as Row)
    const bindings: unknown[] = []
    const values = this.valueTuples(rows, columns, bindings)
    const cols = columns.map((c) => g.wrap(c)).join(', ')
    await this.connection.statement(`INSERT INTO ${g.wrap(this.table)} (${cols}) VALUES ${values}`, bindings)
  }

  /** Insert rows, silently skipping ones that violate a unique constraint. */
  async insertOrIgnore(rows: Row[]): Promise<void> {
    if (rows.length === 0) return
    const g = this.connection.grammar
    const columns = Object.keys(rows[0] as Row)
    const bindings: unknown[] = []
    const values = this.valueTuples(rows, columns, bindings)
    const cols = columns.map((c) => g.wrap(c)).join(', ')
    const prefix = this.connection.dialect === 'sqlite' ? 'INSERT OR IGNORE INTO' : 'INSERT INTO'
    const suffix = this.connection.dialect === 'pg' ? ' ON CONFLICT DO NOTHING' : ''
    await this.connection.statement(
      `${prefix} ${g.wrap(this.table)} (${cols}) VALUES ${values}${suffix}`,
      bindings,
    )
  }

  /** Update rows matching `attributes`, or insert `{...attributes, ...values}`. */
  async updateOrInsert(attributes: Row, values: Row = {}): Promise<void> {
    const match = () => {
      const q = new QueryBuilder(this.connection, this.table)
      for (const [k, v] of Object.entries(attributes)) q.where(k, v)
      return q
    }
    if (await match().exists()) await match().update(values)
    else await this.insertMany([{ ...attributes, ...values }])
  }
}

/**
 * Start a query builder on `table` without a model, à la Laravel's `DB::table()`.
 * Returns raw rows (not model instances). Pass a connection name to target a
 * non-default connection.
 */
export function table(name: string, connection?: string): QueryBuilder {
  return new QueryBuilder(useConnection(connection), name)
}
