import { useConnection } from './connection'
import type { EloquentBuilder } from './eloquent-builder'
import { EloquentCollection } from './eloquent-collection'
import type { Model, ModelClass } from './model'
import { QueryBuilder } from './query-builder'

/** Optional callback to constrain a relation's query (eager loads, whereHas). */
export type RelationConstraint<R extends Model> = (query: EloquentBuilder<R>) => void

/** Parent-key column + values a relation exists for (used by whereHas). */
export interface ExistenceKeys {
  column: string
  values: unknown[]
}

/**
 * Base relationship. Constrained to the parent, chainable, and able to
 * eager-load for many parents at once (no N+1), count, and answer existence.
 */
export abstract class Relation<R extends Model> {
  protected readonly builder: EloquentBuilder<R>
  private constrained = false

  constructor(
    protected readonly parent: Model,
    protected readonly related: ModelClass<R>,
  ) {
    this.builder = related.query()
  }

  protected abstract addConstraints(): void
  abstract eager(parents: Model[], name: string, constrain?: RelationConstraint<R>): Promise<void>
  abstract existenceKeys(constrain?: RelationConstraint<R>): Promise<ExistenceKeys>

  /** Per-parent-key related-row counts (for `has(rel, '>', n)`). */
  async existenceCounts(
    _constrain?: RelationConstraint<R>,
  ): Promise<{ column: string; counts: Map<unknown, number> }> {
    throw new Error('[eloquent] has() with a count is not supported on this relation')
  }

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

  /** Set `<name>_count` on each parent (generic: loads then counts). */
  async eagerCount(parents: Model[], name: string): Promise<void> {
    await this.eager(parents, name)
    for (const parent of parents) {
      const loaded = parent.getRelation(name)
      const count = loaded instanceof EloquentCollection ? loaded.count() : loaded ? 1 : 0
      parent.setAttribute(`${name}_count`, count)
      delete parent.relations[name] // keep withCount lightweight
    }
  }

  /** Set `<name>_<fn>_<column>` on each parent (withSum/withAvg/withMax/withMin). */
  async eagerAggregate(
    parents: Model[],
    name: string,
    fn: 'sum' | 'avg' | 'min' | 'max',
    column: string,
  ): Promise<void> {
    await this.eager(parents, name)
    for (const parent of parents) {
      const loaded = parent.getRelation(name)
      const rows = (
        loaded instanceof EloquentCollection ? loaded.all() : loaded ? [loaded] : []
      ) as Model[]
      const values = rows.map((m) => Number(m.getAttribute(column)))
      let agg = 0
      if (values.length) {
        if (fn === 'sum') agg = values.reduce((a, b) => a + b, 0)
        else if (fn === 'avg') agg = values.reduce((a, b) => a + b, 0) / values.length
        else if (fn === 'min') agg = Math.min(...values)
        else agg = Math.max(...values)
      }
      parent.setAttribute(`${name}_${fn}_${column}`, agg)
      delete parent.relations[name]
    }
  }
}

/**
 * Eager-load a dot-path (`posts.comments`) onto a set of already-fetched models,
 * with an optional constraint on the leaf. Shared by the query builder,
 * `Model.load`, and `EloquentCollection.load`.
 */
export async function eagerLoad(
  models: Model[],
  path: string,
  constrain?: RelationConstraint<Model>,
): Promise<void> {
  if (models.length === 0) return
  const [head, ...rest] = path.split('.')
  const source = models[0] as unknown as Record<string, () => Relation<Model>>
  const relation = source[head as string]?.()
  if (!relation) return
  await relation.eager(models, head as string, rest.length ? undefined : constrain)
  if (rest.length === 0) return

  const children: Model[] = []
  for (const model of models) {
    const loaded = model.getRelation(head as string)
    if (loaded instanceof EloquentCollection) children.push(...loaded.all())
    else if (loaded) children.push(loaded as Model)
  }
  await eagerLoad(children, rest.join('.'), constrain)
}

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
  async eager(parents: Model[], name: string, constrain?: RelationConstraint<R>): Promise<void> {
    const keys = parents.map((p) => p.getAttribute(this.localKey))
    const query = this.related.query().whereIn(this.foreignKey, keys)
    constrain?.(query)
    const grouped = (await query.get()).groupBy(this.foreignKey as keyof R)
    for (const parent of parents) {
      const items = grouped[String(parent.getAttribute(this.localKey))]?.all() ?? []
      parent.setRelation(name, new EloquentCollection(items))
    }
  }
  async existenceKeys(constrain?: RelationConstraint<R>): Promise<ExistenceKeys> {
    const query = this.related.query().select(this.foreignKey)
    constrain?.(query)
    const rows = await query.get()
    return {
      column: this.localKey,
      values: [...new Set(rows.all().map((m) => m.getAttribute(this.foreignKey)))],
    }
  }
  override async existenceCounts(constrain?: RelationConstraint<R>) {
    const query = this.related.query().select(this.foreignKey)
    constrain?.(query)
    const counts = new Map<unknown, number>()
    for (const m of (await query.get()).all()) {
      const k = m.getAttribute(this.foreignKey)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return { column: this.localKey, counts }
  }
}

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
  async eager(parents: Model[], name: string, constrain?: RelationConstraint<R>): Promise<void> {
    const keys = parents.map((p) => p.getAttribute(this.localKey))
    const query = this.related.query().whereIn(this.foreignKey, keys)
    constrain?.(query)
    const grouped = (await query.get()).groupBy(this.foreignKey as keyof R)
    for (const parent of parents) {
      parent.setRelation(name, grouped[String(parent.getAttribute(this.localKey))]?.first())
    }
  }
  async existenceKeys(constrain?: RelationConstraint<R>): Promise<ExistenceKeys> {
    const query = this.related.query().select(this.foreignKey)
    constrain?.(query)
    const rows = await query.get()
    return {
      column: this.localKey,
      values: [...new Set(rows.all().map((m) => m.getAttribute(this.foreignKey)))],
    }
  }
}

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
  async eager(parents: Model[], name: string, constrain?: RelationConstraint<R>): Promise<void> {
    const keys = parents.map((p) => p.getAttribute(this.foreignKey))
    const query = this.related.query().whereIn(this.ownerKey, keys)
    constrain?.(query)
    const keyed = (await query.get()).keyBy(this.ownerKey as keyof R)
    for (const parent of parents) {
      parent.setRelation(name, keyed[String(parent.getAttribute(this.foreignKey))])
    }
  }
  async existenceKeys(constrain?: RelationConstraint<R>): Promise<ExistenceKeys> {
    const query = this.related.query().select(this.ownerKey)
    constrain?.(query)
    const rows = await query.get()
    return {
      column: this.foreignKey,
      values: [...new Set(rows.all().map((m) => m.getAttribute(this.ownerKey)))],
    }
  }
}

/** Many-to-many via a pivot table (two queries: pivot → related). */
export class BelongsToMany<R extends Model> extends Relation<R> {
  constructor(
    parent: Model,
    related: ModelClass<R>,
    private readonly pivotTable: string,
    private readonly foreignPivotKey: string,
    private readonly relatedPivotKey: string,
    private readonly parentKey: string,
    private readonly relatedKey: string,
    /** For polymorphic pivots: the `*_type` column and the constant it holds. */
    private readonly morphType?: string,
    private readonly morphClass?: string,
  ) {
    super(parent, related)
  }
  private pivotTimestamps = false
  protected addConstraints(): void {}
  private pivot(): QueryBuilder {
    const q = new QueryBuilder(useConnection(), this.pivotTable)
    if (this.morphType) q.where(this.morphType, this.morphClass)
    return q
  }
  /** Attach the pivot row (all its columns) onto each related model as `pivot`. */
  withPivot(): this {
    return this // pivot columns are always attached; kept for API familiarity
  }
  /** Set created_at/updated_at on the pivot when attaching. */
  withTimestamps(): this {
    this.pivotTimestamps = true
    return this
  }
  private attachPivot(models: R[], pivotRows: Record<string, unknown>[]): void {
    const byRelated = new Map(pivotRows.map((r) => [String(r[this.relatedPivotKey]), r]))
    for (const model of models) {
      model.setRelation('pivot', byRelated.get(String(model.getAttribute(this.relatedKey))))
    }
  }
  override async get(): Promise<EloquentCollection<R>> {
    const rows = await this.pivot()
      .where(this.foreignPivotKey, this.parent.getAttribute(this.parentKey))
      .get()
    const ids = rows.map((r) => r[this.relatedPivotKey])
    if (ids.length === 0) return new EloquentCollection<R>([])
    const related = await this.related.query().whereIn(this.relatedKey, ids).get()
    this.attachPivot(related.all(), rows)
    return related
  }
  override async first(): Promise<R | undefined> {
    return (await this.get()).first()
  }
  async attach(ids: unknown | unknown[]): Promise<void> {
    const list = Array.isArray(ids) ? ids : [ids]
    const parentId = this.parent.getAttribute(this.parentKey)
    const now = new Date().toISOString()
    for (const id of list) {
      const row: Record<string, unknown> = {
        [this.foreignPivotKey]: parentId,
        [this.relatedPivotKey]: id,
      }
      if (this.morphType) row[this.morphType] = this.morphClass
      if (this.pivotTimestamps) {
        row.created_at = now
        row.updated_at = now
      }
      await this.pivot().insert(row)
    }
  }
  async detach(ids?: unknown | unknown[]): Promise<void> {
    const query = this.pivot().where(this.foreignPivotKey, this.parent.getAttribute(this.parentKey))
    if (ids !== undefined) query.whereIn(this.relatedPivotKey, Array.isArray(ids) ? ids : [ids])
    await query.delete()
  }
  async sync(ids: unknown[]): Promise<void> {
    await this.detach()
    await this.attach(ids)
  }
  /** Current related ids linked to the parent in the pivot table. */
  private async currentPivotIds(): Promise<unknown[]> {
    const rows = await this.pivot()
      .where(this.foreignPivotKey, this.parent.getAttribute(this.parentKey))
      .get()
    return rows.map((r) => r[this.relatedPivotKey])
  }
  /** Attach the given ids without detaching existing ones. */
  async syncWithoutDetaching(ids: unknown[]): Promise<void> {
    const current = new Set((await this.currentPivotIds()).map(String))
    const toAttach = ids.filter((id) => !current.has(String(id)))
    if (toAttach.length) await this.attach(toAttach)
  }
  /** Attach ids not present, detach ids that are — flipping each. */
  async toggle(ids: unknown[]): Promise<void> {
    const current = new Set((await this.currentPivotIds()).map(String))
    const attach: unknown[] = []
    const detach: unknown[] = []
    for (const id of ids) (current.has(String(id)) ? detach : attach).push(id)
    if (attach.length) await this.attach(attach)
    if (detach.length) await this.detach(detach)
  }
  /** Update pivot columns for one already-attached related id. */
  async updateExistingPivot(id: unknown, attributes: Record<string, unknown>): Promise<void> {
    const values = { ...attributes }
    if (this.pivotTimestamps) values.updated_at = new Date().toISOString()
    await this.pivot()
      .where(this.foreignPivotKey, this.parent.getAttribute(this.parentKey))
      .where(this.relatedPivotKey, id)
      .update(values)
  }
  async eager(parents: Model[], name: string, constrain?: RelationConstraint<R>): Promise<void> {
    const parentKeys = parents.map((p) => p.getAttribute(this.parentKey))
    const pivotRows = await this.pivot().whereIn(this.foreignPivotKey, parentKeys).get()
    const relatedIds = [...new Set(pivotRows.map((r) => r[this.relatedPivotKey]))]
    let related = new EloquentCollection<R>([])
    if (relatedIds.length) {
      const query = this.related.query().whereIn(this.relatedKey, relatedIds)
      constrain?.(query)
      related = await query.get()
    }
    this.attachPivot(related.all(), pivotRows)
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
  async existenceKeys(constrain?: RelationConstraint<R>): Promise<ExistenceKeys> {
    const query = this.related.query().select(this.relatedKey)
    constrain?.(query)
    const relatedIds = (await query.get()).all().map((m) => m.getAttribute(this.relatedKey))
    if (!relatedIds.length) return { column: this.parentKey, values: [] }
    const pivotRows = await this.pivot().whereIn(this.relatedPivotKey, relatedIds).get()
    return {
      column: this.parentKey,
      values: [...new Set(pivotRows.map((r) => r[this.foreignPivotKey]))],
    }
  }
  override async existenceCounts(constrain?: RelationConstraint<R>) {
    const query = this.related.query().select(this.relatedKey)
    constrain?.(query)
    const relatedIds = (await query.get()).all().map((m) => m.getAttribute(this.relatedKey))
    const counts = new Map<unknown, number>()
    if (relatedIds.length) {
      const pivotRows = await this.pivot().whereIn(this.relatedPivotKey, relatedIds).get()
      for (const row of pivotRows) {
        const k = row[this.foreignPivotKey]
        counts.set(k, (counts.get(k) ?? 0) + 1)
      }
    }
    return { column: this.parentKey, counts }
  }
}

/** Polymorphic one-to-many: related.<name>_id = parent.id AND <name>_type = parent class. */
export class MorphMany<R extends Model> extends Relation<R> {
  private readonly idField: string
  private readonly typeField: string
  constructor(
    parent: Model,
    related: ModelClass<R>,
    morphName: string,
    private readonly localKey = 'id',
  ) {
    super(parent, related)
    this.idField = `${morphName}_id`
    this.typeField = `${morphName}_type`
  }
  protected addConstraints(): void {
    this.builder
      .where(this.idField, this.parent.getAttribute(this.localKey))
      .where(this.typeField, this.parent.constructor.name)
  }
  async eager(parents: Model[], name: string, constrain?: RelationConstraint<R>): Promise<void> {
    const type = parents[0]?.constructor.name
    const keys = parents.map((p) => p.getAttribute(this.localKey))
    const query = this.related.query().whereIn(this.idField, keys).where(this.typeField, type)
    constrain?.(query)
    const grouped = (await query.get()).groupBy(this.idField as keyof R)
    for (const parent of parents) {
      const items = grouped[String(parent.getAttribute(this.localKey))]?.all() ?? []
      parent.setRelation(name, new EloquentCollection(items))
    }
  }
  async existenceKeys(constrain?: RelationConstraint<R>): Promise<ExistenceKeys> {
    const query = this.related.query().select(this.idField).where(this.typeField, this.parent.constructor.name)
    constrain?.(query)
    const rows = await query.get()
    return { column: this.localKey, values: [...new Set(rows.all().map((m) => m.getAttribute(this.idField)))] }
  }
  override async existenceCounts(constrain?: RelationConstraint<R>) {
    const query = this.related
      .query()
      .select(this.idField)
      .where(this.typeField, this.parent.constructor.name)
    constrain?.(query)
    const counts = new Map<unknown, number>()
    for (const m of (await query.get()).all()) {
      const k = m.getAttribute(this.idField)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return { column: this.localKey, counts }
  }
}

/** Polymorphic one-to-one. */
export class MorphOne<R extends Model> extends MorphMany<R> {
  async getResults(): Promise<R | undefined> {
    return (await this.get()).first()
  }
}

/** The inverse polymorphic relation: resolves the owner via a type map. */
export class MorphTo extends Relation<Model> {
  private readonly idField: string
  private readonly typeField: string
  constructor(
    parent: Model,
    morphName: string,
    private readonly typeMap: Record<string, ModelClass<Model>>,
  ) {
    super(parent, parent.constructor as ModelClass<Model>)
    this.idField = `${morphName}_id`
    this.typeField = `${morphName}_type`
  }
  protected addConstraints(): void {}
  override async first(): Promise<Model | undefined> {
    const cls = this.typeMap[String(this.parent.getAttribute(this.typeField))]
    if (!cls) return undefined
    return cls.query().where(cls.primaryKey, this.parent.getAttribute(this.idField)).first()
  }
  override async get(): Promise<EloquentCollection<Model>> {
    const model = await this.first()
    return new EloquentCollection(model ? [model] : [])
  }
  async eager(parents: Model[], name: string): Promise<void> {
    const byType = new Map<string, Model[]>()
    for (const parent of parents) {
      const type = String(parent.getAttribute(this.typeField))
      const bucket = byType.get(type) ?? []
      bucket.push(parent)
      byType.set(type, bucket)
    }
    for (const [type, group] of byType) {
      const cls = this.typeMap[type]
      if (!cls) {
        for (const parent of group) parent.setRelation(name, undefined)
        continue
      }
      const ids = group.map((p) => p.getAttribute(this.idField))
      const keyed = (await cls.query().whereIn(cls.primaryKey, ids).get()).keyBy(
        cls.primaryKey as keyof Model,
      )
      for (const parent of group) {
        parent.setRelation(name, keyed[String(parent.getAttribute(this.idField))])
      }
    }
  }
  async existenceKeys(): Promise<ExistenceKeys> {
    throw new Error('[eloquent] whereHas is not supported on morphTo relations')
  }
}

/** Has-many-through: parent → through → far (two hops, two queries). */
export class HasManyThrough<R extends Model> extends Relation<R> {
  constructor(
    parent: Model,
    far: ModelClass<R>,
    private readonly through: ModelClass<Model>,
    private readonly firstKey: string, // through.<firstKey> = parent.<localKey>
    private readonly secondKey: string, // far.<secondKey> = through.<secondLocalKey>
    private readonly localKey: string,
    private readonly secondLocalKey: string,
  ) {
    super(parent, far)
  }
  protected addConstraints(): void {}
  private async throughRows(parentKeys: unknown[]) {
    return (await this.through.query().whereIn(this.firstKey, parentKeys).get()).all()
  }
  override async get(): Promise<EloquentCollection<R>> {
    const rows = await this.throughRows([this.parent.getAttribute(this.localKey)])
    const throughIds = rows.map((t) => t.getAttribute(this.secondLocalKey))
    if (throughIds.length === 0) return new EloquentCollection<R>([])
    return this.related.query().whereIn(this.secondKey, throughIds).get()
  }
  async eager(parents: Model[], name: string): Promise<void> {
    const rows = await this.throughRows(parents.map((p) => p.getAttribute(this.localKey)))
    const throughToParent = new Map<string, string>()
    for (const t of rows) {
      throughToParent.set(String(t.getAttribute(this.secondLocalKey)), String(t.getAttribute(this.firstKey)))
    }
    const throughIds = rows.map((t) => t.getAttribute(this.secondLocalKey))
    const far = throughIds.length
      ? await this.related.query().whereIn(this.secondKey, throughIds).get()
      : new EloquentCollection<R>([])
    const byParent = new Map<string, R[]>()
    for (const model of far.all()) {
      const parentKey = throughToParent.get(String(model.getAttribute(this.secondKey)))
      if (parentKey === undefined) continue
      const bucket = byParent.get(parentKey) ?? []
      bucket.push(model)
      byParent.set(parentKey, bucket)
    }
    for (const parent of parents) {
      const bucket = byParent.get(String(parent.getAttribute(this.localKey))) ?? []
      parent.setRelation(name, new EloquentCollection(bucket))
    }
  }
  override async first(): Promise<R | undefined> {
    return (await this.get()).first()
  }
  async existenceKeys(): Promise<ExistenceKeys> {
    throw new Error('[eloquent] whereHas is not supported on hasManyThrough relations')
  }
}

/** Distant one-to-one through an intermediate model. */
export class HasOneThrough<R extends Model> extends HasManyThrough<R> {
  async getResults(): Promise<R | undefined> {
    return this.first()
  }
  override async eager(parents: Model[], name: string): Promise<void> {
    await super.eager(parents, name)
    for (const parent of parents) {
      const loaded = parent.getRelation(name)
      parent.setRelation(name, loaded instanceof EloquentCollection ? loaded.first() : loaded)
    }
  }
}
