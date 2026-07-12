import { EloquentCollection } from './eloquent-collection'
import type { Model } from './model'
import type { Operator, QueryBuilder } from './query-builder'
import type { Relation } from './relations'

type Row = Record<string, unknown>
/** Constrain a relation's query in `with`/`whereHas` (loosely typed by design). */
// biome-ignore lint/suspicious/noExplicitAny: constraint receives the related model's builder
export type EagerConstraint = (query: any) => void

/** A page of results plus pagination metadata. */
export interface Paginator<M extends Model> {
  data: EloquentCollection<M>
  total: number
  perPage: number
  currentPage: number
  lastPage: number
}

/**
 * Wraps a {@link QueryBuilder}, forwarding the fluent chain and hydrating result
 * rows into model instances wrapped in a {@link EloquentCollection}. Also applies
 * the model's global scopes and soft-delete filtering at execution time.
 */
export class EloquentBuilder<M extends Model> {
  private readonly eagerLoads: { path: string; constrain?: EagerConstraint }[] = []
  private readonly countLoads: string[] = []
  private readonly hasSpecs: { name: string; constrain?: EagerConstraint }[] = []
  private trashed: 'default' | 'with' | 'only' = 'default'
  private readonly removedScopes = new Set<string>()
  private prepared = false

  constructor(
    private readonly qb: QueryBuilder,
    private readonly hydrate: (row: Row) => M,
    private readonly model: typeof Model,
  ) {}

  /** Eager-load relations: `with('posts')`, `with('posts.comments')`, or
   *  `with({ posts: (q) => q.where('published', 1) })`. */
  with(...specs: (string | Record<string, EagerConstraint>)[]): this {
    for (const spec of specs) {
      if (typeof spec === 'string') this.eagerLoads.push({ path: spec })
      else for (const [path, constrain] of Object.entries(spec)) this.eagerLoads.push({ path, constrain })
    }
    return this
  }
  /** Add a `<relation>_count` attribute per row. */
  withCount(...names: string[]): this {
    this.countLoads.push(...names)
    return this
  }
  /** Restrict to rows that HAVE the relation (optionally constrained). */
  has(name: string): this {
    this.hasSpecs.push({ name })
    return this
  }
  whereHas(name: string, constrain?: EagerConstraint): this {
    this.hasSpecs.push({ name, constrain })
    return this
  }
  where(column: string, operatorOrValue?: unknown, value?: unknown): this {
    this.qb.where(column, operatorOrValue, value)
    return this
  }
  orWhere(column: string, operatorOrValue?: unknown, value?: unknown): this {
    this.qb.orWhere(column, operatorOrValue, value)
    return this
  }
  whereIn(column: string, values: unknown[]): this {
    this.qb.whereIn(column, values)
    return this
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
  sum(column: string): Promise<number> {
    this.prepare()
    return this.qb.sum(column)
  }
  avg(column: string): Promise<number> {
    this.prepare()
    return this.qb.avg(column)
  }
  min(column: string): Promise<number> {
    this.prepare()
    return this.qb.min(column)
  }
  max(column: string): Promise<number> {
    this.prepare()
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
    if (this.prepared) return
    this.prepared = true

    if (this.model.softDeletes) {
      const column = this.model.deletedAtColumn
      if (this.trashed === 'default') this.qb.whereNull(column)
      else if (this.trashed === 'only') this.qb.whereNotNull(column)
    }
    if (!this.removedScopes.has('*')) {
      for (const [name, fn] of this.model.globalScopeEntries()) {
        if (!this.removedScopes.has(name)) fn(this.qb)
      }
    }
  }

  /** Resolve a relation object from a source model instance (or a template). */
  private relationOf(name: string, source?: Model): Relation<Model> | undefined {
    const on = source ?? new this.model()
    const fn = (on as unknown as Record<string, () => Relation<Model>>)[name]
    return typeof fn === 'function' ? fn.call(on) : undefined
  }

  /** Recursively eager-load a dot-path (`posts.comments`) with an optional leaf constraint. */
  private async eagerLoadPath(models: Model[], path: string, constrain?: EagerConstraint): Promise<void> {
    if (models.length === 0) return
    const [head, ...rest] = path.split('.')
    const relation = this.relationOf(head as string, models[0])
    if (!relation) return
    await relation.eager(models, head as string, rest.length ? undefined : constrain)
    if (rest.length === 0) return

    const children: Model[] = []
    for (const model of models) {
      const loaded = model.getRelation(head as string)
      if (loaded instanceof EloquentCollection) children.push(...loaded.all())
      else if (loaded) children.push(loaded as Model)
    }
    await this.eagerLoadPath(children, rest.join('.'), constrain)
  }

  async get(): Promise<EloquentCollection<M>> {
    this.prepare()
    // whereHas / has — resolve existence into the main query before executing.
    for (const spec of this.hasSpecs) {
      const relation = this.relationOf(spec.name)
      if (!relation) continue
      const { column, values } = await relation.existenceKeys(spec.constrain)
      this.qb.whereIn(column, values)
    }

    const rows = await this.qb.get()
    const models = rows.map((r) => this.hydrate(r))

    for (const name of this.countLoads) {
      if (models.length === 0) break
      await this.relationOf(name, models[0])?.eagerCount(models, name)
    }
    for (const { path, constrain } of this.eagerLoads) {
      await this.eagerLoadPath(models, path, constrain)
    }
    return new EloquentCollection(models)
  }
  async first(): Promise<M | undefined> {
    this.qb.limit(1)
    return (await this.get()).first() // get() applies scopes + eager loading
  }
  count(): Promise<number> {
    this.prepare()
    return this.qb.count()
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
  exists(): Promise<boolean> {
    this.prepare()
    return this.qb.exists()
  }
}

export type { Operator }
