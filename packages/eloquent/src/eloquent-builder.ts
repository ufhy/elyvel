import { EloquentCollection } from './eloquent-collection'
import type { Model } from './model'
import type { Operator, QueryBuilder } from './query-builder'
import type { Relation } from './relations'

type Row = Record<string, unknown>

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
  private readonly eagerLoads: string[] = []
  private trashed: 'default' | 'with' | 'only' = 'default'
  private readonly removedScopes = new Set<string>()
  private prepared = false

  constructor(
    private readonly qb: QueryBuilder,
    private readonly hydrate: (row: Row) => M,
    private readonly model: typeof Model,
  ) {}

  with(...names: string[]): this {
    this.eagerLoads.push(...names)
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
  orderBy(column: string, direction: 'asc' | 'desc' = 'asc'): this {
    this.qb.orderBy(column, direction)
    return this
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

  async get(): Promise<EloquentCollection<M>> {
    this.prepare()
    const rows = await this.qb.get()
    const models = rows.map((r) => this.hydrate(r))
    for (const name of this.eagerLoads) {
      if (models.length === 0) break
      const relation = (models[0] as unknown as Record<string, () => Relation<Model>>)[name]?.()
      if (relation) await relation.eager(models, name)
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
