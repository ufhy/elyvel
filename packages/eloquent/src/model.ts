import { useConnection } from './connection'
import { EloquentBuilder } from './eloquent-builder'
import type { EloquentCollection } from './eloquent-collection'
import { QueryBuilder } from './query-builder'
import { BelongsTo, BelongsToMany, HasMany, HasOne } from './relations'

export type Attributes = Record<string, unknown>

/** Constructor + statics view of a Model subclass, for typing static helpers. */
export type ModelClass<M extends Model> = { new (attributes?: Attributes): M } & typeof Model

export type CastType =
  | 'int'
  | 'integer'
  | 'float'
  | 'double'
  | 'boolean'
  | 'bool'
  | 'string'
  | 'json'
  | 'array'

/** Cast a raw (DB or user-set) value to its JS representation for reads. */
function castGet(type: CastType, value: unknown): unknown {
  if (value === null || value === undefined) return value
  switch (type) {
    case 'int':
    case 'integer':
    case 'float':
    case 'double':
      return Number(value)
    case 'boolean':
    case 'bool':
      return value === true || value === 1 || value === '1' || value === 't'
    case 'string':
      return String(value)
    case 'json':
    case 'array':
      return typeof value === 'string' ? JSON.parse(value) : value
  }
}

/** Cast a JS value to its storage representation for writes (dialect-aware). */
function castStore(type: CastType, value: unknown, dialect: string): unknown {
  if (value === null || value === undefined) return value
  switch (type) {
    case 'boolean':
    case 'bool':
      return dialect === 'pg' ? Boolean(value) : value ? 1 : 0
    case 'json':
    case 'array':
      return typeof value === 'string' ? value : JSON.stringify(value)
    default:
      return value
  }
}

type ScopeFn = (qb: QueryBuilder) => void

// Per-class global scope registries (WeakMap keyed by the class constructor).
const GLOBAL_SCOPES = new WeakMap<Function, Map<string, ScopeFn>>()
function ownScopes(cls: Function): Map<string, ScopeFn> {
  let map = GLOBAL_SCOPES.get(cls)
  if (!map) {
    map = new Map()
    GLOBAL_SCOPES.set(cls, map)
  }
  return map
}

const RESERVED = new Set(['attributes', 'original', 'exists', 'relations'])

// A Proxy gives Eloquent's `$model->attribute` ergonomics: unknown property
// reads/writes fall through to the attribute bag (with dirty tracking on write).
const proxyHandler: ProxyHandler<Model> = {
  get(target, prop, receiver) {
    if (typeof prop !== 'string' || prop in target) return Reflect.get(target, prop, receiver)
    return target.getAttribute(prop) // applies casts
  },
  set(target, prop, value, receiver) {
    if (typeof prop !== 'string' || RESERVED.has(prop) || prop in target) {
      return Reflect.set(target, prop, value, receiver)
    }
    target.setAttribute(prop, value)
    return true
  },
}

function serializeRelation(value: unknown): unknown {
  if (value == null) return value
  const v = value as { toArray?: () => unknown; toObject?: () => unknown }
  if (typeof v.toArray === 'function') return v.toArray() // Collection
  if (typeof v.toObject === 'function') return v.toObject() // Model
  return value
}

/**
 * Laravel Eloquent-style Active Record base. A subclass maps to a table; each
 * instance is a row. Attributes are accessed directly (`user.name`), with dirty
 * tracking, `$hidden` serialization, and automatic timestamps.
 */
export class Model {
  /** Table name. Defaults to the lower-cased class name + "s". */
  static table?: string
  static primaryKey = 'id'
  static timestamps = true
  /** Attribute names hidden from `toObject()`/`toJSON()`. */
  static hidden: string[] = []
  /** Attribute casts, e.g. `{ active: 'boolean', meta: 'json', age: 'int' }`. */
  static casts: Record<string, CastType> = {}
  /** Enable soft deletes (requires a `deleted_at` column). */
  static softDeletes = false
  static deletedAtColumn = 'deleted_at'

  /** Register a named global scope applied to every query for this model. */
  static addGlobalScope(name: string, scope: ScopeFn): void {
    ownScopes(this).set(name, scope)
  }

  /** Collect global scopes from this class and its ancestors. */
  static globalScopeEntries(): [string, ScopeFn][] {
    const merged = new Map<string, ScopeFn>()
    const chain: Function[] = []
    let cursor: unknown = this
    while (typeof cursor === 'function' && cursor !== Model) {
      chain.unshift(cursor)
      cursor = Object.getPrototypeOf(cursor)
    }
    for (const cls of chain) {
      const map = GLOBAL_SCOPES.get(cls)
      if (map) for (const [name, fn] of map) merged.set(name, fn)
    }
    return [...merged]
  }

  attributes: Attributes = {}
  original: Attributes = {}
  exists = false
  /** Loaded relations (populated by eager loading via `with()`). */
  relations: Record<string, unknown> = {}

  constructor(attributes: Attributes = {}) {
    for (const [key, value] of Object.entries(attributes)) this.attributes[key] = value
    return new Proxy(this, proxyHandler)
  }

  // ── config ──────────────────────────────────────────────────────────────
  static getTableName(): string {
    return this.table ?? `${this.name.toLowerCase()}s`
  }

  // ── static query API ──────────────────────────────────────────────────────
  static query<M extends Model>(this: ModelClass<M>): EloquentBuilder<M> {
    const qb = new QueryBuilder(useConnection(), this.getTableName())
    return new EloquentBuilder<M>(qb, (row) => this.hydrate(row), this)
  }

  static all<M extends Model>(this: ModelClass<M>): Promise<EloquentCollection<M>> {
    return this.query().get()
  }

  static where<M extends Model>(
    this: ModelClass<M>,
    column: string,
    operatorOrValue?: unknown,
    value?: unknown,
  ): EloquentBuilder<M> {
    return this.query().where(column, operatorOrValue, value)
  }

  static find<M extends Model>(this: ModelClass<M>, id: unknown): Promise<M | undefined> {
    return this.query().where(this.primaryKey, id).first()
  }

  static async findOrFail<M extends Model>(this: ModelClass<M>, id: unknown): Promise<M> {
    const model = await this.find(id)
    if (!model) throw new Error(`[eloquent] No ${this.name} found for ${this.primaryKey}=${id}`)
    return model
  }

  static first<M extends Model>(this: ModelClass<M>): Promise<M | undefined> {
    return this.query().first()
  }

  static async create<M extends Model>(this: ModelClass<M>, attributes: Attributes): Promise<M> {
    const model = new this(attributes)
    await model.save()
    return model
  }

  static hydrate<M extends Model>(this: ModelClass<M>, row: Attributes): M {
    const model = new this()
    model.attributes = { ...row }
    model.original = { ...row }
    model.exists = true
    return model
  }

  static async firstOrCreate<M extends Model>(
    this: ModelClass<M>,
    attributes: Attributes,
    values: Attributes = {},
  ): Promise<M> {
    let query = this.query()
    for (const [key, value] of Object.entries(attributes)) query = query.where(key, value)
    return (await query.first()) ?? this.create({ ...attributes, ...values })
  }

  static async updateOrCreate<M extends Model>(
    this: ModelClass<M>,
    attributes: Attributes,
    values: Attributes = {},
  ): Promise<M> {
    let query = this.query()
    for (const [key, value] of Object.entries(attributes)) query = query.where(key, value)
    const existing = await query.first()
    if (existing) {
      await existing.update(values)
      return existing
    }
    return this.create({ ...attributes, ...values })
  }

  // ── instance API ────────────────────────────────────────────────────────
  private self(): typeof Model {
    return this.constructor as typeof Model
  }

  setAttribute(key: string, value: unknown): void {
    this.attributes[key] = value
  }
  getAttribute(key: string): unknown {
    const type = this.self().casts[key]
    const value = this.attributes[key]
    return type ? castGet(type, value) : value
  }

  /** Attributes in DB-storage form (casts applied for the active dialect). */
  private toStorage(attributes: Attributes): Attributes {
    const casts = this.self().casts
    const dialect = useConnection().dialect
    const out: Attributes = { ...attributes }
    for (const key of Object.keys(out)) {
      if (casts[key]) out[key] = castStore(casts[key], out[key], dialect)
    }
    return out
  }
  fill(attributes: Attributes): this {
    for (const [key, value] of Object.entries(attributes)) this.setAttribute(key, value)
    return this
  }
  getKey(): unknown {
    return this.attributes[this.self().primaryKey]
  }

  // ── relationships ─────────────────────────────────────────────────────────
  /** Parent has many related rows (FK defaults to `<thisClass>_id`). */
  hasMany<R extends Model>(
    related: ModelClass<R>,
    foreignKey = `${this.constructor.name.toLowerCase()}_id`,
    localKey = this.self().primaryKey,
  ): HasMany<R> {
    return new HasMany<R>(this, related, foreignKey, localKey)
  }
  /** Parent has one related row. */
  hasOne<R extends Model>(
    related: ModelClass<R>,
    foreignKey = `${this.constructor.name.toLowerCase()}_id`,
    localKey = this.self().primaryKey,
  ): HasOne<R> {
    return new HasOne<R>(this, related, foreignKey, localKey)
  }
  /** Parent belongs to a related row (FK on this model, defaults `<related>_id`). */
  belongsTo<R extends Model>(
    related: ModelClass<R>,
    foreignKey = `${related.name.toLowerCase()}_id`,
    ownerKey = related.primaryKey,
  ): BelongsTo<R> {
    return new BelongsTo<R>(this, related, foreignKey, ownerKey)
  }

  /** Many-to-many through a pivot table (defaults: sorted `a_b` table, `<class>_id` keys). */
  belongsToMany<R extends Model>(
    related: ModelClass<R>,
    pivotTable?: string,
    foreignPivotKey?: string,
    relatedPivotKey?: string,
    parentKey?: string,
    relatedKey?: string,
  ): BelongsToMany<R> {
    const a = this.constructor.name.toLowerCase()
    const b = related.name.toLowerCase()
    return new BelongsToMany<R>(
      this,
      related,
      pivotTable ?? [a, b].sort().join('_'),
      foreignPivotKey ?? `${a}_id`,
      relatedPivotKey ?? `${b}_id`,
      parentKey ?? this.self().primaryKey,
      relatedKey ?? related.primaryKey,
    )
  }

  setRelation(name: string, value: unknown): this {
    this.relations[name] = value
    return this
  }
  getRelation<T = unknown>(name: string): T {
    return this.relations[name] as T
  }

  getDirty(): Attributes {
    const dirty: Attributes = {}
    for (const [key, value] of Object.entries(this.attributes)) {
      if (value !== this.original[key]) dirty[key] = value
    }
    return dirty
  }
  isDirty(key?: string): boolean {
    const dirty = this.getDirty()
    return key ? key in dirty : Object.keys(dirty).length > 0
  }
  isClean(key?: string): boolean {
    return !this.isDirty(key)
  }

  async save(): Promise<this> {
    const self = this.self()
    const now = new Date().toISOString()
    const qb = () => new QueryBuilder(useConnection(), self.getTableName())

    if (this.exists) {
      if (self.timestamps) this.attributes.updated_at = now
      const dirty = this.getDirty()
      if (Object.keys(dirty).length > 0) {
        await qb().where(self.primaryKey, this.getKey()).update(this.toStorage(dirty))
      }
    } else {
      if (self.timestamps) {
        this.attributes.created_at ??= now
        this.attributes.updated_at ??= now
      }
      const row = await qb().insert(this.toStorage(this.attributes))
      this.attributes = { ...this.attributes, ...row } // pick up generated id/defaults
      this.exists = true
    }
    this.original = { ...this.attributes }
    return this
  }

  async update(attributes: Attributes): Promise<this> {
    this.fill(attributes)
    return this.save()
  }

  /** Delete the row — soft (sets `deleted_at`) when soft deletes are enabled. */
  async delete(): Promise<void> {
    const self = this.self()
    if (self.softDeletes) {
      this.setAttribute(self.deletedAtColumn, new Date().toISOString())
      await this.save()
      return
    }
    await this.forceDelete()
  }

  /** Permanently delete the row, ignoring soft deletes. */
  async forceDelete(): Promise<void> {
    const self = this.self()
    await new QueryBuilder(useConnection(), self.getTableName())
      .where(self.primaryKey, this.getKey())
      .delete()
    this.exists = false
  }

  /** Restore a soft-deleted row. */
  async restore(): Promise<void> {
    this.setAttribute(this.self().deletedAtColumn, null)
    await this.save()
  }

  /** Whether the row is soft-deleted. */
  trashed(): boolean {
    return this.getAttribute(this.self().deletedAtColumn) != null
  }

  /** Casted attributes minus hidden — used by serialization. */
  toObject(): Attributes {
    const hidden = new Set(this.self().hidden)
    const out: Attributes = {}
    for (const key of Object.keys(this.attributes)) {
      if (!hidden.has(key)) out[key] = this.getAttribute(key)
    }
    return out
  }
  /** Serialized attributes plus any loaded relations. */
  toJSON(): Attributes {
    const out = this.toObject()
    for (const [name, value] of Object.entries(this.relations)) {
      out[name] = serializeRelation(value)
    }
    return out
  }
}
