import type { EloquentCollection } from './eloquent-collection'
import type { Model, ModelClass } from './model'
import type { Operator, QueryBuilder } from './query-builder'
import type { Relation } from './relations'
import { LazyCollection } from '@elyvel/support'
import { eagerLoad, MorphTo } from './relations'

type Row = Record<string, unknown>
/** Constrain a relation's query in `with`/`whereHas` (loosely typed by design). */
export type EagerConstraint = (query: any) => void

function compareCount(value: number, operator: string, target: number): boolean {
  switch (operator) {
    case '=':
      return value === target
    case '!=':
      return value !== target
    case '<':
      return value < target
    case '<=':
      return value <= target
    case '>':
      return value > target
    case '>=':
      return value >= target
    default:
      return false
  }
}

/**
 * A page of results plus pagination metadata. The index signature lets it
 * pass straight into `@elyvel/core`'s `Resource.paginated(paginator, ...)`
 * without a cast.
 */
export interface Paginator<M extends Model> {
  data: EloquentCollection<M>
  total: number
  perPage: number
  currentPage: number
  lastPage: number
  [key: string]: unknown
}
/** A page without a total COUNT (cheaper) — just "is there more?". */
export interface SimplePaginator<M extends Model> {
  data: EloquentCollection<M>
  perPage: number
  currentPage: number
  hasMore: boolean
  [key: string]: unknown
}
/** Keyset (cursor) pagination — scales to large offsets. */
export interface CursorPaginator<M extends Model> {
  data: EloquentCollection<M>
  perPage: number
  nextCursor: unknown
}

/**
 * Wraps a {@link QueryBuilder}, forwarding the fluent chain and hydrating result
 * rows into model instances wrapped in a {@link EloquentCollection}. Also applies
 * the model's global scopes and soft-delete filtering at execution time.
 */
export class EloquentBuilder<M extends Model> {
  private readonly eagerLoads: { path: string, constrain?: EagerConstraint }[] = []
  private readonly countLoads: string[] = []
  private readonly aggLoads: { name: string, fn: 'sum' | 'avg' | 'min' | 'max', column: string }[]
    = []

  private readonly hasSpecs: {
    name: string
    constrain?: EagerConstraint
    boolean: 'AND' | 'OR'
    negate: boolean
    operator?: string
    count?: number
  }[] = []

  private readonly morphSpecs: {
    name: string
    types: ModelClass<Model>[]
    constrain?: EagerConstraint
    boolean: 'AND' | 'OR'
    negate: boolean
  }[] = []

  private trashed: 'default' | 'with' | 'only' = 'default'
  private readonly removedScopes = new Set<string>()
  private prepared = false
  private existenceResolved = false

  constructor(
    private readonly qb: QueryBuilder,
    private readonly hydrate: (row: Row) => M,
    private readonly model: typeof Model,
  ) {}

  /**
   * Eager-load relations: `with('posts')`, `with('posts.comments')`, or
   *  `with({ posts: (q) => q.where('published', 1) })`.
   */
  with(...specs: (string | Record<string, EagerConstraint>)[]): this {
    for (const spec of specs) {
      if (typeof spec === 'string') {
        this.eagerLoads.push({ path: spec })
      }
      else {
        for (const [path, constrain] of Object.entries(spec))
          this.eagerLoads.push({ path, constrain })
      }
    }
    return this
  }

  /** Add a `<relation>_count` attribute per row. */
  withCount(...names: string[]): this {
    this.countLoads.push(...names)
    return this
  }

  withSum(name: string, column: string): this {
    this.aggLoads.push({ name, fn: 'sum', column })
    return this
  }

  withAvg(name: string, column: string): this {
    this.aggLoads.push({ name, fn: 'avg', column })
    return this
  }

  withMax(name: string, column: string): this {
    this.aggLoads.push({ name, fn: 'max', column })
    return this
  }

  withMin(name: string, column: string): this {
    this.aggLoads.push({ name, fn: 'min', column })
    return this
  }

  /** Rows that HAVE the relation — optionally `has('posts', '>', 3)`. */
  has(name: string, operator?: string, count?: number): this {
    this.hasSpecs.push({ name, boolean: 'AND', negate: false, operator, count })
    return this
  }

  doesntHave(name: string): this {
    this.hasSpecs.push({ name, boolean: 'AND', negate: true })
    return this
  }

  whereHas(name: string, constrain?: EagerConstraint): this {
    this.hasSpecs.push({ name, constrain, boolean: 'AND', negate: false })
    return this
  }

  orWhereHas(name: string, constrain?: EagerConstraint): this {
    this.hasSpecs.push({ name, constrain, boolean: 'OR', negate: false })
    return this
  }

  whereDoesntHave(name: string, constrain?: EagerConstraint): this {
    this.hasSpecs.push({ name, constrain, boolean: 'AND', negate: true })
    return this
  }

  orWhereDoesntHave(name: string, constrain?: EagerConstraint): this {
    this.hasSpecs.push({ name, constrain, boolean: 'OR', negate: true })
    return this
  }

  /**
   * `whereHas` for a `morphTo` relation. Because the target table varies, name the
   * types to check: rows kept are those whose morph target is one of `types` and
   * (optionally) matches `constrain`.
   *
   * @example
   * Comment.query().whereHasMorph('commentable', [Post, Video], q => q.where('published', true))
   */
  whereHasMorph(name: string, types: ModelClass<Model>[], constrain?: EagerConstraint): this {
    this.morphSpecs.push({ name, types, constrain, boolean: 'AND', negate: false })
    return this
  }

  orWhereHasMorph(name: string, types: ModelClass<Model>[], constrain?: EagerConstraint): this {
    this.morphSpecs.push({ name, types, constrain, boolean: 'OR', negate: false })
    return this
  }

  whereDoesntHaveMorph(name: string, types: ModelClass<Model>[], constrain?: EagerConstraint): this {
    this.morphSpecs.push({ name, types, constrain, boolean: 'AND', negate: true })
    return this
  }

  /** Apply a named local scope declared in `static scopes`. */
  scope(name: string, ...args: unknown[]): this {
    const fn = this.model.scopes[name]
    if (fn)
      fn(this as unknown as EloquentBuilder<Model>, ...args)
    return this
  }

  where(
    column: string | ((q: QueryBuilder) => void),
    operatorOrValue?: unknown,
    value?: unknown,
  ): this {
    this.qb.where(column, operatorOrValue, value)
    return this
  }

  orWhere(
    column: string | ((q: QueryBuilder) => void),
    operatorOrValue?: unknown,
    value?: unknown,
  ): this {
    this.qb.orWhere(column, operatorOrValue, value)
    return this
  }

  whereColumn(first: string, operator: string, second: string): this {
    this.qb.whereColumn(first, operator, second)
    return this
  }

  whereNotIn(column: string, values: unknown[]): this {
    this.qb.whereNotIn(column, values)
    return this
  }

  orWhereIn(column: string, values: unknown[]): this {
    this.qb.orWhereIn(column, values)
    return this
  }

  whereNotBetween(column: string, range: [unknown, unknown]): this {
    this.qb.whereNotBetween(column, range)
    return this
  }

  when(condition: unknown, then: (q: this) => void, otherwise?: (q: this) => void): this {
    if (condition)
      then(this)
    else otherwise?.(this)
    return this
  }

  orderByDesc(column: string): this {
    this.qb.orderByDesc(column)
    return this
  }

  union(other: EloquentBuilder<Model> | QueryBuilder): this {
    this.qb.union('getQuery' in other ? other.getQuery() : other)
    return this
  }

  lockForUpdate(): this {
    this.qb.lockForUpdate()
    return this
  }

  sharedLock(): this {
    this.qb.sharedLock()
    return this
  }

  latest(column = 'created_at'): this {
    this.qb.latest(column)
    return this
  }

  oldest(column = 'created_at'): this {
    this.qb.oldest(column)
    return this
  }

  whereIn(column: string, values: unknown[] | QueryBuilder): this {
    this.qb.whereIn(column, values)
    return this
  }

  whereRaw(sql: string, bindings: unknown[] = []): this {
    this.qb.whereRaw(sql, bindings)
    return this
  }

  selectRaw(sql: string, bindings: unknown[] = []): this {
    this.qb.selectRaw(sql, bindings)
    return this
  }

  orderByRaw(sql: string): this {
    this.qb.orderByRaw(sql)
    return this
  }

  havingRaw(sql: string, bindings: unknown[] = []): this {
    this.qb.havingRaw(sql, bindings)
    return this
  }

  whereExists(sub: QueryBuilder): this {
    this.qb.whereExists(sub)
    return this
  }

  /** The underlying query builder (e.g. to use this query as a subquery). */
  getQuery(): QueryBuilder {
    return this.qb
  }

  whereNull(column: string): this {
    this.qb.whereNull(column)
    return this
  }

  whereNotNull(column: string): this {
    this.qb.whereNotNull(column)
    return this
  }

  whereBetween(column: string, range: [unknown, unknown]): this {
    this.qb.whereBetween(column, range)
    return this
  }

  select(...columns: string[]): this {
    this.qb.select(...columns)
    return this
  }

  distinct(): this {
    this.qb.distinct()
    return this
  }

  join(table: string, first: string, operator: string, second: string): this {
    this.qb.join(table, first, operator, second)
    return this
  }

  leftJoin(table: string, first: string, operator: string, second: string): this {
    this.qb.leftJoin(table, first, operator, second)
    return this
  }

  groupBy(...columns: string[]): this {
    this.qb.groupBy(...columns)
    return this
  }

  having(column: string, operator: string, value: unknown): this {
    this.qb.having(column, operator, value)
    return this
  }

  orderBy(column: string, direction: 'asc' | 'desc' = 'asc'): this {
    this.qb.orderBy(column, direction)
    return this
  }

  async sum(column: string): Promise<number> {
    this.prepare()
    await this.resolveExistence()
    return this.qb.sum(column)
  }

  async avg(column: string): Promise<number> {
    this.prepare()
    await this.resolveExistence()
    return this.qb.avg(column)
  }

  async min(column: string): Promise<number> {
    this.prepare()
    await this.resolveExistence()
    return this.qb.min(column)
  }

  async max(column: string): Promise<number> {
    this.prepare()
    await this.resolveExistence()
    return this.qb.max(column)
  }

  limit(n: number): this {
    this.qb.limit(n)
    return this
  }

  offset(n: number): this {
    this.qb.offset(n)
    return this
  }

  /** Include soft-deleted rows in the results. */
  withTrashed(): this {
    this.trashed = 'with'
    return this
  }

  /** Return only soft-deleted rows. */
  onlyTrashed(): this {
    this.trashed = 'only'
    return this
  }

  /** Exclude soft-deleted rows (the default — for reverting an earlier `withTrashed()`/`onlyTrashed()` in the same chain). */
  withoutTrashed(): this {
    this.trashed = 'default'
    return this
  }

  /** Skip a named global scope for this query. */
  withoutGlobalScope(name: string): this {
    this.removedScopes.add(name)
    return this
  }

  /** Skip all global scopes for this query. */
  withoutGlobalScopes(): this {
    this.removedScopes.add('*')
    return this
  }

  private prepare(): void {
    if (this.prepared)
      return
    this.prepared = true

    if (this.model.softDeletes) {
      const column = this.model.deletedAtColumn
      if (this.trashed === 'default')
        this.qb.whereNull(column)
      else if (this.trashed === 'only')
        this.qb.whereNotNull(column)
    }
    if (!this.removedScopes.has('*')) {
      for (const [name, fn] of this.model.globalScopeEntries()) {
        if (!this.removedScopes.has(name))
          fn(this.qb)
      }
    }
  }

  /** Resolve a relation object from a source model instance (or a template). */
  private relationOf(name: string, source?: Model): Relation<Model> | undefined {
    const on = source ?? new this.model()
    const fn = (on as unknown as Record<string, () => Relation<Model>>)[name]
    return typeof fn === 'function' ? fn.call(on) : undefined
  }

  /** Resolve whereHas/has/doesntHave into the underlying query (once). */
  private async resolveExistence(): Promise<void> {
    if (this.existenceResolved)
      return
    this.existenceResolved = true
    for (const spec of this.hasSpecs) {
      const relation = this.relationOf(spec.name)
      if (!relation)
        continue
      if (spec.operator && spec.count !== undefined) {
        const { column, counts } = await relation.existenceCounts(spec.constrain)
        const keys = [...counts.entries()]
          .filter(([, c]) => compareCount(c, spec.operator as string, spec.count as number))
          .map(([k]) => k)
        if (spec.boolean === 'OR')
          this.qb.orWhereIn(column, keys)
        else this.qb.whereIn(column, keys)
      }
      else {
        const { column, values } = await relation.existenceKeys(spec.constrain)
        if (spec.negate) {
          if (spec.boolean === 'OR')
            this.qb.orWhereNotIn(column, values)
          else this.qb.whereNotIn(column, values)
        }
        else if (spec.boolean === 'OR') {
          this.qb.orWhereIn(column, values)
        }
        else {
          this.qb.whereIn(column, values)
        }
      }
    }

    for (const spec of this.morphSpecs) {
      const relation = this.relationOf(spec.name)
      if (!(relation instanceof MorphTo))
        continue
      const { typeField, idField, groups } = await relation.morphExistence(spec.types, spec.constrain)
      // (type = A AND id IN […]) OR (type = B AND id IN […]) …
      const build = (q: QueryBuilder): void => {
        for (const g of groups)
          q.orWhere(sub => sub.where(typeField, g.type).whereIn(idField, g.ids))
      }
      if (spec.negate)
        spec.boolean === 'OR' ? this.qb.orWhereNot(build) : this.qb.whereNot(build)
      else
        spec.boolean === 'OR' ? this.qb.orWhere(build) : this.qb.where(build)
    }
  }

  async get(): Promise<EloquentCollection<M>> {
    this.prepare()
    await this.resolveExistence()
    const rows = await this.qb.get()
    const models = rows.map(r => this.hydrate(r))
    await this.model.fireRetrieved(models)

    for (const name of this.countLoads) {
      if (models.length === 0)
        break
      await this.relationOf(name, models[0])?.eagerCount(models, name)
    }
    for (const { name, fn, column } of this.aggLoads) {
      if (models.length === 0)
        break
      await this.relationOf(name, models[0])?.eagerAggregate(models, name, fn, column)
    }
    for (const { path, constrain } of this.eagerLoads) {
      await eagerLoad(models, path, constrain)
    }
    return (this.model as unknown as ModelClass<M>).newCollection(models)
  }

  async first(): Promise<M | undefined> {
    this.qb.limit(1)
    return (await this.get()).first() // get() applies scopes + eager loading
  }

  /** The single matching row; throws if zero or more than one match. */
  async sole(): Promise<M> {
    this.qb.limit(2)
    const rows = (await this.get()).all()
    if (rows.length === 0)
      throw new Error('[eloquent] sole(): no records found.')
    if (rows.length > 1)
      throw new Error('[eloquent] sole(): multiple records found.')
    return rows[0] as M
  }

  /** Stream rows lazily in chunks (memory-bounded) as a LazyCollection. */
  cursor(chunkSize = 100): LazyCollection<M> {
    this.prepare()
    const qb = this.qb
    const hydrate = this.hydrate
    const resolve = () => this.resolveExistence()
    return new LazyCollection<M>(async function* () {
      await resolve()
      let page = 0
      while (true) {
        const rows = await qb
          .offset(page * chunkSize)
          .limit(chunkSize)
          .get()
        if (rows.length === 0)
          break
        for (const row of rows) yield hydrate(row)
        if (rows.length < chunkSize)
          break
        page++
      }
    })
  }

  async count(): Promise<number> {
    this.prepare()
    await this.resolveExistence()
    return this.qb.count()
  }

  async update(values: Row): Promise<void> {
    this.prepare()
    await this.qb.update(values)
  }

  async delete(): Promise<void> {
    this.prepare()
    await this.qb.delete()
  }

  increment(column: string, amount = 1, extra: Row = {}): Promise<void> {
    this.prepare()
    return this.qb.increment(column, amount, extra)
  }

  decrement(column: string, amount = 1, extra: Row = {}): Promise<void> {
    this.prepare()
    return this.qb.decrement(column, amount, extra)
  }

  /** Fetch one page plus totals. Runs a COUNT then a limited/offset SELECT. */
  async paginate(perPage = 15, page = 1): Promise<Paginator<M>> {
    const total = await this.count()
    this.offset((page - 1) * perPage).limit(perPage)
    const data = await this.get()
    return {
      data,
      total,
      perPage,
      currentPage: page,
      lastPage: Math.max(1, Math.ceil(total / perPage)),
    }
  }

  /** Page without a COUNT — fetches perPage+1 to detect a next page. */
  async simplePaginate(perPage = 15, page = 1): Promise<SimplePaginator<M>> {
    this.offset((page - 1) * perPage).limit(perPage + 1)
    const items = (await this.get()).all()
    const hasMore = items.length > perPage
    return {
      data: (this.model as unknown as ModelClass<M>).newCollection(items.slice(0, perPage)),
      perPage,
      currentPage: page,
      hasMore,
    }
  }

  /** Keyset pagination on `column` (default `id`), ascending. */
  async cursorPaginate(
    perPage = 15,
    cursor?: number | string,
    column = 'id',
  ): Promise<CursorPaginator<M>> {
    if (cursor !== undefined)
      this.qb.where(column, '>', cursor)
    this.qb.orderBy(column, 'asc')
    this.qb.limit(perPage + 1)
    const items = (await this.get()).all()
    const hasMore = items.length > perPage
    const data = items.slice(0, perPage)
    const nextCursor = hasMore ? (data[data.length - 1]?.getAttribute(column) ?? null) : null
    return { data: (this.model as unknown as ModelClass<M>).newCollection(data), perPage, nextCursor }
  }

  async value<T = unknown>(column: string): Promise<T | undefined> {
    this.prepare()
    await this.resolveExistence()
    return this.qb.value<T>(column)
  }

  async pluck<T = unknown>(column: string): Promise<T[]> {
    this.prepare()
    await this.resolveExistence()
    return this.qb.pluck<T>(column)
  }

  async exists(): Promise<boolean> {
    this.prepare()
    await this.resolveExistence()
    return this.qb.exists()
  }
}

export type { Operator }
