/**
 * Optional model serialization (Laravel's `SerializesModels`): instead of
 * storing a full model in the job payload, store a reference (class + id) and
 * re-fetch a fresh instance on the worker. Wire it with
 * {@link configureModelSerializer}; without it, values serialize as-is.
 */
export interface ModelReference {
  model: string
  id: unknown
}

export interface ModelSerializer {
  /** Return a reference if `value` is a model, else undefined. */
  dehydrate(value: unknown): ModelReference | undefined
  /** Re-fetch a fresh model for a reference (null if it no longer exists). */
  hydrate(ref: ModelReference): Promise<unknown>
}

const MARKER = '__elyvel_model__'

let serializer: ModelSerializer | null = null
export function configureModelSerializer(store: ModelSerializer): void {
  serializer = store
}
export function modelSerializer(): ModelSerializer | null {
  return serializer
}

/** Replace model values in a payload with `{ __elyvel_model__: ref }` markers. */
export function dehydrateData(data: Record<string, unknown>): Record<string, unknown> {
  if (!serializer)
    return data
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      out[key] = value.map((v) => {
        const ref = serializer?.dehydrate(v)
        return ref ? { [MARKER]: ref } : v
      })
    }
    else {
      const ref = serializer.dehydrate(value)
      out[key] = ref ? { [MARKER]: ref } : value
    }
  }
  return out
}

/** Re-fetch models on a reconstructed job's own fields (replaces markers). */
export async function hydrateModels(job: Record<string, unknown>): Promise<void> {
  if (!serializer)
    return
  for (const key of Object.keys(job)) {
    const value = job[key]
    if (Array.isArray(value)) {
      job[key] = await Promise.all(value.map(v => resolve(v)))
    }
    else {
      job[key] = await resolve(value)
    }
  }
}

async function resolve(value: unknown): Promise<unknown> {
  if (
    serializer
    && value
    && typeof value === 'object'
    && MARKER in (value as Record<string, unknown>)
  ) {
    return serializer.hydrate((value as Record<string, ModelReference>)[MARKER] as ModelReference)
  }
  return value
}
