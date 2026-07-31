/**
 * Array/object helpers mirroring Laravel's `Illuminate\Support\Arr`. Works on
 * plain objects and arrays with `"dot.notation"` paths. Reads never mutate;
 * `set`/`forget` mutate the target in place (like Laravel).
 */

type Dict = Record<string, unknown>

function isDict(value: unknown): value is Dict {
  return value !== null && typeof value === 'object'
}

/**
 * Keys that must never be written through a dot-path.
 *
 * Assigning to `__proto__` sets an object's PROTOTYPE rather than creating a
 * property, so walking a path through it hands the caller
 * `Object.prototype` — and the next write pollutes every object in the process.
 * Laravel's `Arr::set` has no equivalent hazard because PHP arrays have no
 * prototype chain, so a straight port inherits a vulnerability the original
 * doesn't have.
 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/** Is `key` unsafe to write through a dot-path? See {@link UNSAFE_KEYS}. */
export function isUnsafeKey(key: string): boolean {
  return UNSAFE_KEYS.has(key)
}

function assertSafePath(path: string, segments: string[]): void {
  for (const segment of segments) {
    if (isUnsafeKey(segment)) {
      throw new TypeError(
        `[elyvel] Refusing to write through the unsafe path segment "${segment}" `
        + `in "${path}" — it would modify the prototype chain rather than the `
        + 'target. If this path came from user input, reject it upstream.',
      )
    }
  }
}

/** Read a dot-path value, returning `fallback` (or undefined) if any segment is missing. */
function arrGet<T>(target: unknown, path: string | null, fallback: T): T
function arrGet<T = unknown>(target: unknown, path: string | null): T | undefined
function arrGet(target: unknown, path: string | null, fallback?: unknown): unknown {
  if (path === null || path === '')
    return target ?? fallback
  let current: unknown = target
  for (const segment of path.split('.')) {
    if (Array.isArray(current))
      current = current[Number(segment)]
    else if (isDict(current))
      current = current[segment]
    else
      return fallback
    if (current === undefined)
      return fallback
  }
  return current ?? fallback
}

export const Arr = {
  get: arrGet,

  /** Whether a dot-path exists (even if its value is null/undefined at the leaf's parent). */
  has(target: unknown, path: string): boolean {
    let current: unknown = target
    for (const segment of path.split('.')) {
      if (Array.isArray(current) && segment in current)
        current = current[Number(segment)]
      else if (isDict(current) && segment in current)
        current = current[segment]
      else
        return false
    }
    return true
  },

  /** Set a dot-path value, creating intermediate objects. Mutates and returns `target`. */
  set(target: Dict, path: string, value: unknown): Dict {
    const segments = path.split('.')
    assertSafePath(path, segments)
    let current: Dict = target
    for (let i = 0; i < segments.length - 1; i++) {
      const key = segments[i]!
      if (!isDict(current[key]))
        current[key] = {}
      current = current[key] as Dict
    }
    current[segments[segments.length - 1]!] = value
    return target
  },

  /** Remove a dot-path key. Mutates `target`. */
  forget(target: Dict, path: string): void {
    const segments = path.split('.')
    assertSafePath(path, segments)
    let current: Dict = target
    for (let i = 0; i < segments.length - 1; i++) {
      const key = segments[i]!
      if (!isDict(current[key]))
        return
      current = current[key] as Dict
    }
    delete current[segments[segments.length - 1]!]
  },

  /** A new object with only the listed keys. */
  only<T extends Dict>(target: T, keys: string[]): Partial<T> {
    const out: Dict = {}
    for (const key of keys) {
      if (key in target)
        out[key] = target[key]
    }
    return out as Partial<T>
  },

  /** A new object without the listed keys. */
  except<T extends Dict>(target: T, keys: string[]): Partial<T> {
    const drop = new Set(keys)
    const out: Dict = {}
    for (const [key, value] of Object.entries(target)) {
      if (!drop.has(key))
        out[key] = value
    }
    return out as Partial<T>
  },

  /** Pull a column out of an array of objects; optionally key the result by another column. */
  pluck<T extends Dict>(array: T[], value: string, key?: string): unknown[] | Dict {
    if (key === undefined)
      return array.map(item => arrGet(item, value))
    const out: Dict = {}
    for (const item of array) out[String(arrGet(item, key))] = arrGet(item, value)
    return out
  },

  /** Wrap a non-array value in an array (null/undefined → []); pass arrays through. */
  wrap<T>(value: T | T[] | null | undefined): T[] {
    if (value === null || value === undefined)
      return []
    return Array.isArray(value) ? value : [value]
  },

  /** First element (optionally the first matching `predicate`), else `fallback`. */
  first<T>(array: T[], predicate?: (item: T) => boolean, fallback?: T): T | undefined {
    if (!predicate)
      return array.length ? array[0] : fallback
    return array.find(predicate) ?? fallback
  },

  /** Last element (optionally the last matching `predicate`), else `fallback`. */
  last<T>(array: T[], predicate?: (item: T) => boolean, fallback?: T): T | undefined {
    if (!predicate)
      return array.length ? array[array.length - 1] : fallback
    for (let i = array.length - 1; i >= 0; i--) {
      if (predicate(array[i]!))
        return array[i]
    }
    return fallback
  },

  /** Flatten a nested array to `depth` levels (default fully). */
  flatten(array: unknown[], depth = Number.POSITIVE_INFINITY): unknown[] {
    const out: unknown[] = []
    for (const item of array) {
      if (Array.isArray(item) && depth > 0)
        out.push(...Arr.flatten(item, depth - 1))
      else
        out.push(item)
    }
    return out
  },

  /** Collapse an array of arrays into a single array (one level). */
  collapse<T>(array: T[][]): T[] {
    return ([] as T[]).concat(...array)
  },

  /** Whether the value is an associative object (not a list array). */
  isAssoc(value: unknown): boolean {
    return isDict(value) && !Array.isArray(value)
  },

  /**
   * A random element (or `undefined` when empty), uniformly distributed.
   *
   * `random32 % length` is biased by `2**32 % length` — negligible in practice
   * (around 1e-7% for a small array, and this picks an element rather than
   * generating a secret), but rejection sampling costs nothing and means there is
   * one fewer "is this bias big enough to matter?" question in the codebase.
   */
  random<T>(array: T[]): T | undefined {
    if (array.length === 0)
      return undefined
    const n = array.length
    const limit = Math.floor(0x1_0000_0000 / n) * n
    let draw = 0
    do {
      draw = crypto.getRandomValues(new Uint32Array(1))[0] as number
    } while (draw >= limit)
    return array[draw % n]
  },
}
