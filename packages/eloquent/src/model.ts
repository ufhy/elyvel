import { useConnection } from './connection'
import { EloquentBuilder } from './eloquent-builder'
import type { EloquentCollection } from './eloquent-collection'
import { QueryBuilder } from './query-builder'

export type Attributes = Record<string, unknown>

/** Constructor + statics view of a Model subclass, for typing static helpers. */
type ModelClass<M extends Model> = { new (attributes?: Attributes): M } & typeof Model

const RESERVED = new Set(['attributes', 'original', 'exists'])

// A Proxy gives Eloquent's `$model->attribute` ergonomics: unknown property
// reads/writes fall through to the attribute bag (with dirty tracking on write).
const proxyHandler: ProxyHandler<Model> = {
  get(target, prop, receiver) {
    if (typeof prop !== 'string' || prop in target) return Reflect.get(target, prop, receiver)
    return target.attributes[prop]
  },
  set(target, prop, value, receiver) {
    if (typeof prop !== 'string' || RESERVED.has(prop) || prop in target) {
      return Reflect.set(target, prop, value, receiver)
    }
    target.setAttribute(prop, value)
    return true
  },
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

  attributes: Attributes = {}
  original: Attributes = {}
  exists = false

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
    return new EloquentBuilder<M>(qb, (row) => this.hydrate(row))
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
    return this.attributes[key]
  }
  fill(attributes: Attributes): this {
    for (const [key, value] of Object.entries(attributes)) this.setAttribute(key, value)
    return this
  }
  getKey(): unknown {
    return this.attributes[this.self().primaryKey]
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
        await qb().where(self.primaryKey, this.getKey()).update(dirty)
      }
    } else {
      if (self.timestamps) {
        this.attributes.created_at ??= now
        this.attributes.updated_at ??= now
      }
      const row = await qb().insert(this.attributes)
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

  async delete(): Promise<void> {
    const self = this.self()
    await new QueryBuilder(useConnection(), self.getTableName())
      .where(self.primaryKey, this.getKey())
      .delete()
    this.exists = false
  }

  /** Attributes minus hidden — used by serialization. */
  toObject(): Attributes {
    const out = { ...this.attributes }
    for (const key of this.self().hidden) delete out[key]
    return out
  }
  toJSON(): Attributes {
    return this.toObject()
  }
}
