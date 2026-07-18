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
}
