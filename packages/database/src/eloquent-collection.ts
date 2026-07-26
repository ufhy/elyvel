import type { Model } from './model'
import { Collection } from '@elyvel/support'
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
