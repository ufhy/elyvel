import { token } from './container'

/** Runtime shape of loaded configuration: `{ [file]: exportedObject }`. */
export type ConfigData = Record<string, Record<string, unknown>>

/**
 * Typed config repository.
 *
 * Config lives in `config/*.ts` files that each `export default` a plain
 * object. The filename becomes the top-level namespace, so `config/app.ts`
 * is read as `config('app.<key>')`.
 *
 * Applications sharpen the return types by augmenting {@link ConfigSchema}
 * via declaration merging (see the example app).
 */
export type ConfigSchema = {}

export class ConfigRepository {
  constructor(private readonly data: ConfigData) {}

  /** Resolve a value by dot-path, e.g. `get('app.name')`. */
  get<T = unknown>(path: string): T
  /** Resolve a value by dot-path, falling back when absent. */
  get<T>(path: string, fallback: T): T
  get<T>(path: string, fallback?: T): T {
    const segments = path.split('.')
    let current: unknown = this.data

    for (const segment of segments) {
      if (current !== null && typeof current === 'object' && segment in current) {
        current = (current as Record<string, unknown>)[segment]
      } else {
        return fallback as T
      }
    }

    return (current ?? fallback) as T
  }

  /** Whether a dot-path exists. */
  has(path: string): boolean {
    return this.get(path, Symbol.for('missing')) !== Symbol.for('missing')
  }

  /** The whole config tree (used mostly for debugging). */
  all(): ConfigData {
    return this.data
  }
}

export const ConfigToken = token<ConfigRepository>('config')
