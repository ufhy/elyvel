import { EloquentCollection } from './eloquent-collection'
import type { Model } from './model'
import type { Operator, QueryBuilder } from './query-builder'
import type { Relation } from './relations'

type Row = Record<string, unknown>

/**
 * Wraps a {@link QueryBuilder}, forwarding the fluent chain and hydrating result
 * rows into model instances wrapped in a {@link Collection} — the Eloquent
 * query builder returned by `Model.query()`.
 */
export class EloquentBuilder<M extends Model> {
  private readonly eagerLoads: string[] = []

  constructor(
    private readonly qb: QueryBuilder,
    private readonly hydrate: (row: Row) => M,
  ) {}

  /** Eager-load the named relations (one query each, no N+1). */
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

  async get(): Promise<EloquentCollection<M>> {
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
    const row = await this.qb.first()
    return row ? this.hydrate(row) : undefined
  }
  count(): Promise<number> {
    return this.qb.count()
  }
  exists(): Promise<boolean> {
    return this.qb.exists()
  }
}

export type { Operator }
