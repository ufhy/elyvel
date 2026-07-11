import { Collection } from '@elysia-ravel/support'
import type { Model } from './model'

/**
 * The collection returned by Eloquent queries. Extends the foundational
 * {@link Collection} (from `@elysia-ravel/support`) with model-aware helpers —
 * exactly Laravel's `Illuminate\Database\Eloquent\Collection extends
 * Illuminate\Support\Collection`.
 */
export class EloquentCollection<M extends Model> extends Collection<M> {
  /** Primary keys of the contained models. */
  modelKeys(): unknown[] {
    return this.all().map((model) => model.getKey())
  }

  /** Find a contained model by primary key. */
  find(id: unknown): M | undefined {
    return this.first((model) => model.getKey() === id)
  }
}
