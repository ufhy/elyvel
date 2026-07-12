import type { Attributes, Model, ModelClass } from './model'

/** Produces attribute sets for a model, given a 0-based index. */
export type FactoryDefinition = (index: number) => Attributes

/**
 * A model factory for seeding/tests — the Elysia-ravel take on Laravel factories.
 * `make` builds unsaved instances; `create` persists them.
 */
export class Factory<M extends Model> {
  private n = 1
  constructor(
    private readonly model: ModelClass<M>,
    private readonly definition: FactoryDefinition,
  ) {}

  count(n: number): this {
    this.n = n
    return this
  }

  makeOne(overrides: Attributes = {}): M {
    return new this.model({ ...this.definition(0), ...overrides })
  }
  make(overrides: Attributes = {}): M[] {
    return Array.from({ length: this.n }, (_, i) => new this.model({ ...this.definition(i), ...overrides }))
  }
  createOne(overrides: Attributes = {}): Promise<M> {
    return this.model.create({ ...this.definition(0), ...overrides })
  }
  async create(overrides: Attributes = {}): Promise<M[]> {
    const models: M[] = []
    for (let i = 0; i < this.n; i++) {
      models.push(await this.model.create({ ...this.definition(i), ...overrides }))
    }
    return models
  }
}

/** Define a factory: `const userFactory = defineFactory(User, (i) => ({ ... }))`. */
export function defineFactory<M extends Model>(
  model: ModelClass<M>,
  definition: FactoryDefinition,
): () => Factory<M> {
  return () => new Factory(model, definition)
}
