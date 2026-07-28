import type { EloquentBuilder } from './eloquent-builder'
import type { ModelClass } from './model'
import { Collection } from '@elyvel/support'
import { Model } from './model'
import { eagerLoad } from './relations'

/**
 * The collection returned by Eloquent queries. Extends the foundational
 * {@link Collection} (from `@elyvel/support`) with model-aware helpers —
 * exactly Laravel's `Illuminate\Database\Eloquent\Collection extends
 * Illuminate\Support\Collection`.
 */
export class EloquentCollection<M extends Model> extends Collection<M> {
  /** Primary keys of the contained models. */
  modelKeys(): unknown[] {
    return this.all().map(model => model.getKey())
  }

  /** Find a contained model by primary key. */
  find(id: unknown): M | undefined {
    return this.first(model => model.getKey() === id)
  }

  /** Like {@link find}, but throws if no model in the collection matches `id`. */
  findOrFail(id: unknown): M {
    const model = this.find(id)
    if (!model)
      throw new Error(`[eloquent] No model found in collection for key: ${String(id)}`)
    return model
  }

  /**
   * Whether a model (matched by primary key), a given primary key value, or a
   * predicate (the base `Collection`'s behavior) matches something in the
   * collection. A model argument compares by `getKey()`; anything else that
   * isn't a function is treated as the key itself.
   */
  override contains(modelOrIdOrPredicate: M | unknown | ((item: M) => boolean)): boolean {
    if (typeof modelOrIdOrPredicate === 'function')
      return super.contains(modelOrIdOrPredicate as (item: M) => boolean)
    const key = modelOrIdOrPredicate instanceof Model ? modelOrIdOrPredicate.getKey() : modelOrIdOrPredicate
    return this.modelKeys().includes(key)
  }

  /** Only the models whose primary key is in `ids`. */
  only(...ids: unknown[]): EloquentCollection<M> {
    return new EloquentCollection(this.all().filter(model => ids.includes(model.getKey())))
  }

  /** Every model EXCEPT those whose primary key is in `ids`. */
  except(...ids: unknown[]): EloquentCollection<M> {
    return new EloquentCollection(this.all().filter(model => !ids.includes(model.getKey())))
  }

  /** Re-fetch every model in this collection fresh from the database (by primary key). */
  async fresh(): Promise<EloquentCollection<M>> {
    if (this.isEmpty())
      return new EloquentCollection([])
    return this.toQuery().get()
  }

  /**
   * A query builder pre-scoped to this collection's models (`whereIn(primaryKey, modelKeys())`)
   * — for bulk-updating/deleting a fetched set (`posts.toQuery().update({...})`).
   * Throws on an empty collection: there's no model to infer the table from.
   */
  toQuery(): EloquentBuilder<M> {
    const first = this.first()
    if (!first)
      throw new Error('[eloquent] toQuery() needs at least one model to infer the table from.')
    const cls = first.constructor as ModelClass<M>
    return cls.query().whereIn(cls.primaryKey, this.modelKeys())
  }

  /** Reveal hidden attributes on every model in the collection (chainable). */
  makeVisible(...keys: string[]): this {
    for (const model of this.all()) model.makeVisible(...keys)
    return this
  }

  /** Hide attributes on every model in the collection (chainable). */
  makeHidden(...keys: string[]): this {
    for (const model of this.all()) model.makeHidden(...keys)
    return this
  }

  /**
   * Models in this collection not present in `items` — compared by primary
   * key (Laravel's Eloquent Collection semantics), NOT reference equality
   * like the base `Collection`. Without this override, diffing two freshly
   * queried collections of the same rows (different object instances, same
   * keys) would incorrectly return every model.
   */
  override diff(items: M[] | Collection<M>): EloquentCollection<M> {
    const otherKeys = new Set((items instanceof Collection ? items.all() : items).map(m => m.getKey()))
    return new EloquentCollection(this.all().filter(model => !otherKeys.has(model.getKey())))
  }

  /** Models present in both this collection and `items` — compared by primary key. */
  override intersect(items: M[] | Collection<M>): EloquentCollection<M> {
    const otherKeys = new Set((items instanceof Collection ? items.all() : items).map(m => m.getKey()))
    return new EloquentCollection(this.all().filter(model => otherKeys.has(model.getKey())))
  }

  /** Distinct models — by primary key (default) or a custom selector, first wins. */
  override unique(by?: keyof M | ((item: M) => unknown)): EloquentCollection<M> {
    const select = by === undefined ? (m: M) => m.getKey() : typeof by === 'function' ? by : (m: M) => m[by]
    const seen = new Set<unknown>()
    const out: M[] = []
    for (const model of this.all()) {
      const k = select(model)
      if (!seen.has(k)) {
        seen.add(k)
        out.push(model)
      }
    }
    return new EloquentCollection(out)
  }

  /** Eager-load relations onto every model in the collection. */
  async load(...paths: string[]): Promise<this> {
    for (const path of paths) await eagerLoad(this.all() as unknown as Model[], path)
    return this
  }

  /** Add `<relation>_count` to every model in the collection (post-fetch counterpart of `withCount`). */
  async loadCount(...names: string[]): Promise<this> {
    const models = this.all() as unknown as Model[]
    if (models.length === 0)
      return this
    for (const name of names) {
      const relation = (models[0] as unknown as Record<string, () => { eagerCount(models: Model[], name: string): Promise<void> } | undefined>)[name]?.()
      await relation?.eagerCount(models, name)
    }
    return this
  }
}
