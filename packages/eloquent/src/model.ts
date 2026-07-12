import { useConnection } from './connection'
import { decrypt, encrypt } from './crypto'
import { EloquentBuilder } from './eloquent-builder'
import type { EloquentCollection } from './eloquent-collection'
import { QueryBuilder } from './query-builder'
import type { EagerConstraint } from './eloquent-builder'
import {
  BelongsTo,
  BelongsToMany,
  eagerLoad,
  HasMany,
  HasManyThrough,
  HasOne,
  HasOneThrough,
  MorphMany,
  MorphOne,
  MorphTo,
} from './relations'

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
  | 'date'
  | 'datetime'
  | 'encrypted'

/** A custom cast / accessor-mutator: transform on read (`get`) and write (`set`). */
export interface CustomCast {
  get?: (value: unknown) => unknown
  set?: (value: unknown) => unknown
}

export type Cast = CastType | CustomCast

/** Cast a raw (DB or user-set) value to its JS representation for reads. */
function castGet(cast: Cast, value: unknown): unknown {
  if (typeof cast === 'object') return cast.get ? cast.get(value) : value
  if (value === null || value === undefined) return value
  switch (cast) {
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
    case 'date':
    case 'datetime':
      return value instanceof Date ? value : new Date(String(value))
    case 'encrypted':
      return JSON.parse(decrypt(String(value)))
  }
}

/** Cast a JS value to its storage representation for writes (dialect-aware). */
function castStore(cast: Cast, value: unknown, dialect: string): unknown {
  if (typeof cast === 'object') return cast.set ? cast.set(value) : value
  if (value === null || value === undefined) return value
  switch (cast) {
    case 'boolean':
    case 'bool':
      return dialect === 'pg' ? Boolean(value) : value ? 1 : 0
    case 'json':
    case 'array':
      return typeof value === 'string' ? value : JSON.stringify(value)
    case 'date':
    case 'datetime':
      return value instanceof Date ? value.toISOString() : String(value)
    case 'encrypted':
      return encrypt(JSON.stringify(value))
    default:
      return value
  }
}

export type ModelEvent =
  | 'saving'
  | 'saved'
  | 'creating'
  | 'created'
  | 'updating'
  | 'updated'
  | 'deleting'
  | 'deleted'

type EventListener = (model: Model) => void | Promise<void>
const MODEL_EVENTS = new WeakMap<Function, Map<ModelEvent, EventListener[]>>()

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
  /** Named connection (from config/database.ts) this model uses; default when unset. */
  static connection?: string
  /** Attribute names hidden from `toObject()`/`toJSON()`. */
  static hidden: string[] = []
  /** If non-empty, ONLY these attributes are serialized (whitelist). */
  static visible: string[] = []
  /** Computed attributes appended to serialization (resolved via `accessors`). */
  static appends: string[] = []
  /** Computed read accessors: `{ full_name: (m) => `${m.first} ${m.last}` }`. */
  static accessors: Record<string, (model: Model) => unknown> = {}
  /** Mass-assignable attributes (whitelist). Empty = allow all not guarded. */
  static fillable: string[] = []
  /** Guarded attributes (blacklist). `['*']` guards everything. */
  static guarded: string[] = []

  static isGuarded(key: string): boolean {
    return this.guarded.includes('*') || this.guarded.includes(key)
  }
  /** Whether `key` may be mass-assigned (via `fill`/`create`/`update`). */
  static isFillable(key: string): boolean {
    if (this.fillable.includes(key)) return true
    if (this.isGuarded(key)) return false
    return this.fillable.length === 0
  }
  /** Attribute casts, e.g. `{ active: 'boolean', meta: 'json', age: 'int' }`. */
  static casts: Record<string, Cast> = {}
  /** Named local scopes: `{ active: (q) => q.where('active', 1) }`. */
  // biome-ignore lint/suspicious/noExplicitAny: scope callbacks receive the model's own builder
  static scopes: Record<string, (query: EloquentBuilder<any>, ...args: unknown[]) => void> = {}

  /** Register a model event listener (creating/created/updating/…/deleted). */
  static on(event: ModelEvent, listener: (model: Model) => void | Promise<void>): void {
    let map = MODEL_EVENTS.get(this)
    if (!map) {
      map = new Map()
      MODEL_EVENTS.set(this, map)
    }
    const list = map.get(event) ?? []
    list.push(listener)
    map.set(event, list)
  }
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
  private readonly makeHiddenSet = new Set<string>()
  private readonly makeVisibleSet = new Set<string>()

  constructor(attributes: Attributes = {}) {
    this.fill(attributes) // respects $fillable/$guarded
    return new Proxy(this, proxyHandler)
  }

  // ── config ──────────────────────────────────────────────────────────────
  static getTableName(): string {
    return this.table ?? `${this.name.toLowerCase()}s`
  }

  // ── static query API ──────────────────────────────────────────────────────
  static query<M extends Model>(this: ModelClass<M>): EloquentBuilder<M> {
    const qb = new QueryBuilder(useConnection(this.connection), this.getTableName())
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

  /** Create bypassing $fillable/$guarded. */
  static async forceCreate<M extends Model>(
    this: ModelClass<M>,
    attributes: Attributes,
  ): Promise<M> {
    const model = new this()
    model.forceFill(attributes)
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
    const self = this.self()
    const accessor = self.accessors[key]
    if (accessor) return accessor(this)
    const type = self.casts[key]
    const value = this.attributes[key]
    return type ? castGet(type, value) : value
  }

  /** Hide attributes for this instance only (chainable). */
  makeHidden(...keys: string[]): this {
    for (const key of keys) this.makeHiddenSet.add(key)
    return this
  }
  /** Reveal hidden attributes for this instance only (chainable). */
  makeVisible(...keys: string[]): this {
    for (const key of keys) this.makeVisibleSet.add(key)
    return this
  }

  /** Attributes in DB-storage form (casts applied for the active dialect). */
  private toStorage(attributes: Attributes): Attributes {
    const casts = this.self().casts
    const dialect = useConnection(this.self().connection).dialect
    const out: Attributes = { ...attributes }
    for (const key of Object.keys(out)) {
      if (casts[key]) out[key] = castStore(casts[key], out[key], dialect)
    }
    return out
  }
  /** Mass-assign only fillable attributes. */
  fill(attributes: Attributes): this {
    const self = this.self()
    for (const [key, value] of Object.entries(attributes)) {
      if (self.isFillable(key)) this.setAttribute(key, value)
    }
    return this
  }
  /** Assign all attributes, bypassing $fillable/$guarded. */
  forceFill(attributes: Attributes): this {
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

  /** Polymorphic one-to-many (related.<morph>_id/_type point back here). */
  morphMany<R extends Model>(related: ModelClass<R>, morphName: string, localKey = 'id'): MorphMany<R> {
    return new MorphMany<R>(this, related, morphName, localKey)
  }
  morphOne<R extends Model>(related: ModelClass<R>, morphName: string, localKey = 'id'): MorphOne<R> {
    return new MorphOne<R>(this, related, morphName, localKey)
  }
  /** Inverse polymorphic relation; `typeMap` resolves `<morph>_type` → model. */
  morphTo(morphName: string, typeMap: Record<string, ModelClass<Model>>): MorphTo {
    return new MorphTo(this, morphName, typeMap)
  }
  /** Distant relation through an intermediate model. */
  hasManyThrough<R extends Model>(
    far: ModelClass<R>,
    through: ModelClass<Model>,
    firstKey = `${this.constructor.name.toLowerCase()}_id`,
    secondKey = `${through.name.toLowerCase()}_id`,
    localKey = this.self().primaryKey,
    secondLocalKey = through.primaryKey,
  ): HasManyThrough<R> {
    return new HasManyThrough<R>(this, far, through, firstKey, secondKey, localKey, secondLocalKey)
  }
  /** Distant one-to-one through an intermediate model. */
  hasOneThrough<R extends Model>(
    far: ModelClass<R>,
    through: ModelClass<Model>,
    firstKey = `${this.constructor.name.toLowerCase()}_id`,
    secondKey = `${through.name.toLowerCase()}_id`,
    localKey = this.self().primaryKey,
    secondLocalKey = through.primaryKey,
  ): HasOneThrough<R> {
    return new HasOneThrough<R>(this, far, through, firstKey, secondKey, localKey, secondLocalKey)
  }

  /** Polymorphic many-to-many (this model owns the morph pivot). */
  morphToMany<R extends Model>(related: ModelClass<R>, morphName: string): BelongsToMany<R> {
    return new BelongsToMany<R>(
      this,
      related,
      `${morphName}s`,
      `${morphName}_id`,
      `${related.name.toLowerCase()}_id`,
      this.self().primaryKey,
      related.primaryKey,
      `${morphName}_type`,
      this.constructor.name,
    )
  }
  /** Inverse polymorphic many-to-many. */
  morphedByMany<R extends Model>(related: ModelClass<R>, morphName: string): BelongsToMany<R> {
    return new BelongsToMany<R>(
      this,
      related,
      `${morphName}s`,
      `${this.constructor.name.toLowerCase()}_id`,
      `${morphName}_id`,
      this.self().primaryKey,
      related.primaryKey,
      `${morphName}_type`,
      related.name,
    )
  }

  setRelation(name: string, value: unknown): this {
    this.relations[name] = value
    return this
  }
  getRelation<T = unknown>(name: string): T {
    return this.relations[name] as T
  }

  /** Eager-load relations onto this instance (supports `'posts.comments'` and constraints). */
  async load(...paths: (string | Record<string, EagerConstraint>)[]): Promise<this> {
    for (const spec of paths) {
      if (typeof spec === 'string') await eagerLoad([this], spec)
      else for (const [path, constrain] of Object.entries(spec)) await eagerLoad([this], path, constrain)
    }
    return this
  }
  /** Like `load`, but skips relations already loaded. */
  async loadMissing(...names: string[]): Promise<this> {
    for (const name of names) {
      const head = name.split('.')[0] as string
      if (!(head in this.relations)) await eagerLoad([this], name)
    }
    return this
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

  /** Fire a model event to listeners registered on this class and its ancestors. */
  private async fireEvent(event: ModelEvent): Promise<void> {
    let cls: unknown = this.constructor
    const chain: Function[] = []
    while (typeof cls === 'function' && cls !== Model) {
      chain.unshift(cls)
      cls = Object.getPrototypeOf(cls)
    }
    for (const c of chain) {
      for (const listener of MODEL_EVENTS.get(c)?.get(event) ?? []) await listener(this)
    }
  }

  async save(): Promise<this> {
    const self = this.self()
    const now = new Date().toISOString()
    const qb = () => new QueryBuilder(useConnection(self.connection), self.getTableName())

    await this.fireEvent('saving')
    if (this.exists) {
      await this.fireEvent('updating')
      if (self.timestamps) this.attributes.updated_at = now
      const dirty = this.getDirty()
      if (Object.keys(dirty).length > 0) {
        await qb().where(self.primaryKey, this.getKey()).update(this.toStorage(dirty))
      }
      this.original = { ...this.attributes }
      await this.fireEvent('updated')
    } else {
      await this.fireEvent('creating')
      if (self.timestamps) {
        this.attributes.created_at ??= now
        this.attributes.updated_at ??= now
      }
      const row = await qb().insert(this.toStorage(this.attributes))
      this.attributes = { ...this.attributes, ...row } // pick up generated id/defaults
      this.exists = true
      this.original = { ...this.attributes }
      await this.fireEvent('created')
    }
    await this.fireEvent('saved')
    return this
  }

  /** Reload this instance's attributes from the database (mutates in place). */
  async refresh(): Promise<this> {
    const self = this.self()
    const row = await new QueryBuilder(useConnection(self.connection), self.getTableName())
      .where(self.primaryKey, this.getKey())
      .first()
    if (row) {
      this.attributes = { ...row }
      this.original = { ...row }
    }
    return this
  }

  /** Return a fresh instance from the database (does not mutate this one). */
  async fresh(): Promise<this | undefined> {
    const model = await (this.constructor as ModelClass<Model>).find(this.getKey())
    return (model as this | undefined) ?? undefined
  }

  async update(attributes: Attributes): Promise<this> {
    this.fill(attributes)
    return this.save()
  }

  /** Delete the row — soft (sets `deleted_at`) when soft deletes are enabled. */
  async delete(): Promise<void> {
    await this.fireEvent('deleting')
    const self = this.self()
    if (self.softDeletes) {
      this.setAttribute(self.deletedAtColumn, new Date().toISOString())
      await this.save()
    } else {
      await this.forceDelete()
    }
    await this.fireEvent('deleted')
  }

  /** Permanently delete the row, ignoring soft deletes. */
  async forceDelete(): Promise<void> {
    const self = this.self()
    await new QueryBuilder(useConnection(self.connection), self.getTableName())
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

  /** Casted attributes (+ appends) minus hidden, honoring visible/per-instance overrides. */
  toObject(): Attributes {
    const self = this.self()
    const hidden = new Set(self.hidden)
    for (const key of this.makeHiddenSet) hidden.add(key)
    for (const key of this.makeVisibleSet) hidden.delete(key)
    const useVisible = self.visible.length > 0
    const out: Attributes = {}
    for (const key of [...Object.keys(this.attributes), ...self.appends]) {
      if (hidden.has(key)) continue
      if (useVisible && !self.visible.includes(key) && !this.makeVisibleSet.has(key)) continue
      out[key] = this.getAttribute(key)
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
