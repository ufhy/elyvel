import { EloquentCollection } from './eloquent-collection'
import type { EloquentBuilder } from './eloquent-builder'
import type { Model, ModelClass } from './model'

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
