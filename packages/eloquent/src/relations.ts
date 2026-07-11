import { useConnection } from './connection'
import { EloquentCollection } from './eloquent-collection'
import type { EloquentBuilder } from './eloquent-builder'
import type { Model, ModelClass } from './model'
import { QueryBuilder } from './query-builder'

/**
 * Base relationship. Holds a related-model query constrained to the parent, is
 * chainable (`where`/`orderBy`/`limit`), and knows how to **eager-load** itself
 * for many parents at once (one query, no N+1).
 */
export abstract class Relation<R extends Model> {
  protected readonly builder: EloquentBuilder<R>
  private constrained = false

  constructor(
    protected readonly parent: Model,
    protected readonly related: ModelClass<R>,
  ) {
    this.builder = related.query()
    // Note: constraints are applied lazily (not here) because subclass key
    // fields are only assigned after super() returns.
  }

  protected abstract addConstraints(): void
  abstract eager(parents: Model[], name: string): Promise<void>

  /** Apply the parent constraint once, before any user constraint/terminal. */
  private ready(): EloquentBuilder<R> {
    if (!this.constrained) {
      this.addConstraints()
      this.constrained = true
    }
    return this.builder
  }

  where(column: string, operatorOrValue?: unknown, value?: unknown): this {
    this.ready().where(column, operatorOrValue, value)
    return this
  }
  orderBy(column: string, direction: 'asc' | 'desc' = 'asc'): this {
    this.ready().orderBy(column, direction)
    return this
  }
  limit(n: number): this {
    this.ready().limit(n)
    return this
  }
  get(): Promise<EloquentCollection<R>> {
    return this.ready().get()
  }
  first(): Promise<R | undefined> {
    return this.ready().first()
  }
}

/** Parent has many related rows: related.foreignKey = parent.localKey. */
export class HasMany<R extends Model> extends Relation<R> {
  constructor(
    parent: Model,
    related: ModelClass<R>,
    private readonly foreignKey: string,
    private readonly localKey: string,
  ) {
    super(parent, related)
  }

  protected addConstraints(): void {
    this.builder.where(this.foreignKey, this.parent.getAttribute(this.localKey))
  }

  async eager(parents: Model[], name: string): Promise<void> {
    const keys = parents.map((p) => p.getAttribute(this.localKey))
    const results = await this.related.query().whereIn(this.foreignKey, keys).get()
    const grouped = results.groupBy(this.foreignKey as keyof R)
    for (const parent of parents) {
      const items = grouped[String(parent.getAttribute(this.localKey))]?.all() ?? []
      parent.setRelation(name, new EloquentCollection(items))
    }
  }
}

/** Parent has one related row. Same keys as HasMany, single result. */
export class HasOne<R extends Model> extends Relation<R> {
  constructor(
    parent: Model,
    related: ModelClass<R>,
    private readonly foreignKey: string,
    private readonly localKey: string,
  ) {
    super(parent, related)
  }

  protected addConstraints(): void {
    this.builder.where(this.foreignKey, this.parent.getAttribute(this.localKey)).limit(1)
  }

  getResults(): Promise<R | undefined> {
    return this.first()
  }

  async eager(parents: Model[], name: string): Promise<void> {
    const keys = parents.map((p) => p.getAttribute(this.localKey))
    const results = await this.related.query().whereIn(this.foreignKey, keys).get()
    const grouped = results.groupBy(this.foreignKey as keyof R)
    for (const parent of parents) {
      parent.setRelation(name, grouped[String(parent.getAttribute(this.localKey))]?.first())
    }
  }
}

/** Parent belongs to a related row: parent.foreignKey = related.ownerKey. */
export class BelongsTo<R extends Model> extends Relation<R> {
  constructor(
    parent: Model,
    related: ModelClass<R>,
    private readonly foreignKey: string,
    private readonly ownerKey: string,
  ) {
    super(parent, related)
  }

  protected addConstraints(): void {
    this.builder.where(this.ownerKey, this.parent.getAttribute(this.foreignKey)).limit(1)
  }

  getResults(): Promise<R | undefined> {
    return this.first()
  }

  async eager(parents: Model[], name: string): Promise<void> {
    const keys = parents.map((p) => p.getAttribute(this.foreignKey))
    const results = await this.related.query().whereIn(this.ownerKey, keys).get()
    const keyed = results.keyBy(this.ownerKey as keyof R)
    for (const parent of parents) {
      parent.setRelation(name, keyed[String(parent.getAttribute(this.foreignKey))])
    }
  }
}

/**
 * Many-to-many via a pivot table. Uses two queries (pivot → related) rather
 * than a JOIN, keeping the query builder simple; `attach`/`detach`/`sync`
 * manage pivot rows.
 */
export class BelongsToMany<R extends Model> extends Relation<R> {
  constructor(
    parent: Model,
    related: ModelClass<R>,
    private readonly pivotTable: string,
    private readonly foreignPivotKey: string,
    private readonly relatedPivotKey: string,
    private readonly parentKey: string,
    private readonly relatedKey: string,
  ) {
    super(parent, related)
  }

  protected addConstraints(): void {
    // Constraints are resolved through the pivot table in get()/eager().
  }

  private pivot(): QueryBuilder {
    return new QueryBuilder(useConnection(), this.pivotTable)
  }

  override async get(): Promise<EloquentCollection<R>> {
    const rows = await this.pivot()
      .where(this.foreignPivotKey, this.parent.getAttribute(this.parentKey))
      .get()
    const ids = rows.map((r) => r[this.relatedPivotKey])
    if (ids.length === 0) return new EloquentCollection<R>([])
    return this.related.query().whereIn(this.relatedKey, ids).get()
  }

  override async first(): Promise<R | undefined> {
    return (await this.get()).first()
  }

  /** Insert pivot rows linking the parent to the given related ids. */
  async attach(ids: unknown | unknown[]): Promise<void> {
    const list = Array.isArray(ids) ? ids : [ids]
    const parentId = this.parent.getAttribute(this.parentKey)
    for (const id of list) {
      await this.pivot().insert({ [this.foreignPivotKey]: parentId, [this.relatedPivotKey]: id })
    }
  }

  /** Remove pivot rows (all for this parent when no ids given). */
  async detach(ids?: unknown | unknown[]): Promise<void> {
    const query = this.pivot().where(this.foreignPivotKey, this.parent.getAttribute(this.parentKey))
    if (ids !== undefined) query.whereIn(this.relatedPivotKey, Array.isArray(ids) ? ids : [ids])
    await query.delete()
  }

  /** Make the pivot exactly match the given related ids. */
  async sync(ids: unknown[]): Promise<void> {
    await this.detach()
    await this.attach(ids)
  }

  async eager(parents: Model[], name: string): Promise<void> {
    const parentKeys = parents.map((p) => p.getAttribute(this.parentKey))
    const pivotRows = await this.pivot().whereIn(this.foreignPivotKey, parentKeys).get()
    const relatedIds = [...new Set(pivotRows.map((r) => r[this.relatedPivotKey]))]
    const related = relatedIds.length
      ? await this.related.query().whereIn(this.relatedKey, relatedIds).get()
      : new EloquentCollection<R>([])
    const relatedById = related.keyBy(this.relatedKey as keyof R)

    const byParent = new Map<string, R[]>()
    for (const row of pivotRows) {
      const model = relatedById[String(row[this.relatedPivotKey])]
      if (!model) continue
      const key = String(row[this.foreignPivotKey])
      const bucket = byParent.get(key) ?? []
      bucket.push(model)
      byParent.set(key, bucket)
    }
    for (const parent of parents) {
      const bucket = byParent.get(String(parent.getAttribute(this.parentKey))) ?? []
      parent.setRelation(name, new EloquentCollection(bucket))
    }
  }
}
