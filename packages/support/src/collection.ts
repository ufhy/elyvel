/**
 * A lean, Laravel-flavored collection over an array — a foundational primitive
 * (mirrors `Illuminate\Support\Collection`), usable anywhere, not tied to the
 * ORM. Deliberately NOT a 180-method clone: native array methods cover most
 * needs, so this adds the high-value chainable helpers plus model-aware
 * serialization. Every transform returns a new Collection.
 */
export class Collection<T> implements Iterable<T> {
  constructor(protected readonly items: T[] = []) {}

  static make<T>(items: T[] = []): Collection<T> {
    return new Collection(items)
  }

  /**
   * Build a new collection of the SAME subclass. Transforms that keep the
   * element type (`filter`, `take`, `sortBy`, …) go through this so a subclass
   * survives the chain — without it, `posts.filter(...)` on an
   * `EloquentCollection` would silently hand back a plain `Collection` and
   * lose `find`/`modelKeys`/`load`/`toQuery`. Transforms that CHANGE the
   * element type (`map`, `pluck`, `flatten`) deliberately don't use this:
   * their result no longer holds the subclass's element type, so they return
   * a base `Collection` — the same distinction Laravel draws.
   */
  protected newInstance(items: T[]): this {
    return new (this.constructor as new (items: T[]) => this)(items)
  }

  all(): T[] {
    return this.items
  }

  count(): number {
    return this.items.length
  }

  isEmpty(): boolean {
    return this.items.length === 0
  }

  isNotEmpty(): boolean {
    return this.items.length > 0
  }

  get(index: number): T | undefined {
    return this.items[index]
  }

  last(): T | undefined {
    return this.items[this.items.length - 1]
  }

  first(predicate?: (item: T) => boolean): T | undefined {
    return predicate ? this.items.find(predicate) : this.items[0]
  }

  map<U>(fn: (item: T, index: number) => U): Collection<U> {
    return new Collection(this.items.map(fn))
  }

  filter(fn: (item: T, index: number) => boolean): this {
    return this.newInstance(this.items.filter(fn))
  }

  /** The inverse of {@link filter} — keep items where `fn` is falsy. */
  reject(fn: (item: T, index: number) => boolean): this {
    return this.newInstance(this.items.filter((item, i) => !fn(item, i)))
  }

  /** Map then flatten one level. */
  flatMap<U>(fn: (item: T, index: number) => U | U[]): Collection<U> {
    return new Collection(this.items.flatMap((item, i) => fn(item, i)))
  }

  /** Flatten nested arrays within the items to `depth` levels. */
  flatten(depth = Number.POSITIVE_INFINITY): Collection<unknown> {
    const out: unknown[] = []
    const walk = (arr: unknown[], d: number): void => {
      for (const v of arr) {
        if (Array.isArray(v) && d > 0)
          walk(v, d - 1)
        else out.push(v)
      }
    }
    walk(this.items, depth)
    return new Collection(out)
  }

  /** Distinct items — by identity, or by a key/selector's value (first wins). */
  unique(by?: keyof T | ((item: T) => unknown)): this {
    const select = by === undefined ? (i: T) => i : typeof by === 'function' ? by : (i: T) => i[by]
    const seen = new Set<unknown>()
    const out: T[] = []
    for (const item of this.items) {
      const k = select(item)
      if (!seen.has(k)) {
        seen.add(k)
        out.push(item)
      }
    }
    return this.newInstance(out)
  }

  reverse(): this {
    return this.newInstance([...this.items].reverse())
  }

  /** Like {@link sortBy} but descending. */
  sortByDesc(by: keyof T | ((item: T) => number | string)): this {
    return this.sortBy(by).reverse()
  }

  /** First `n` items (or the last `|n|` when `n` is negative). */
  take(n: number): this {
    return this.newInstance(n < 0 ? this.items.slice(n) : this.items.slice(0, n))
  }

  /** Drop the first `n` items. */
  skip(n: number): this {
    return this.newInstance(this.items.slice(n))
  }

  slice(start: number, length?: number): this {
    return this.newInstance(this.items.slice(start, length === undefined ? undefined : start + length))
  }

  /** Append more items (array or Collection), returning a new Collection. */
  concat(items: T[] | Collection<T>): this {
    return this.newInstance(this.items.concat(items instanceof Collection ? items.all() : items))
  }

  /** Alias of {@link concat} (Laravel's `merge` for a list collection). */
  merge(items: T[] | Collection<T>): this {
    return this.concat(items)
  }

  /** Items in this collection not present in `items`. */
  diff(items: T[] | Collection<T>): this {
    const other = new Set(items instanceof Collection ? items.all() : items)
    return this.filter(item => !other.has(item))
  }

  /** Items present in both this collection and `items`. */
  intersect(items: T[] | Collection<T>): this {
    const other = new Set(items instanceof Collection ? items.all() : items)
    return this.filter(item => other.has(item))
  }

  /** Join item values (optionally a column's) with `glue`. */
  implode(glue: string, key?: keyof T): string {
    return (key === undefined ? this.items : this.items.map(i => i[key])).join(glue)
  }

  /** Count occurrences keyed by a selector (or the item itself). */
  countBy(by?: keyof T | ((item: T) => unknown)): Record<string, number> {
    const select = by === undefined ? (i: T) => i : typeof by === 'function' ? by : (i: T) => i[by]
    const out: Record<string, number> = {}
    for (const item of this.items) {
      const k = String(select(item))
      out[k] = (out[k] ?? 0) + 1
    }
    return out
  }

  /** Pass the whole collection through `fn` and return its result (Laravel's `pipe`). */
  pipe<U>(fn: (collection: this) => U): U {
    return fn(this)
  }

  /** Run `fn` only when the collection is empty; returns `this` either way. */
  whenEmpty(fn: (collection: this) => void): this {
    if (this.isEmpty())
      fn(this)
    return this
  }

  /** Run `fn` only when the collection is non-empty; returns `this` either way. */
  whenNotEmpty(fn: (collection: this) => void): this {
    if (this.isNotEmpty())
      fn(this)
    return this
  }

  /** The single matching item; throws unless exactly one matches (Laravel's `sole`). */
  sole(predicate?: (item: T) => boolean): T {
    const matches = predicate ? this.items.filter(predicate) : this.items
    if (matches.length === 0)
      throw new Error('[elyvel] Collection.sole(): no matching items.')
    if (matches.length > 1)
      throw new Error(`[elyvel] Collection.sole(): ${matches.length} items matched, expected exactly 1.`)
    return matches[0]!
  }

  /** Map each item to a `[key, value]` pair, collected into a record. */
  mapWithKeys<V>(fn: (item: T, index: number) => [string | number, V]): Record<string, V> {
    const out: Record<string, V> = {}
    this.items.forEach((item, i) => {
      const [k, v] = fn(item, i)
      out[String(k)] = v
    })
    return out
  }

  reduce<U>(fn: (carry: U, item: T) => U, initial: U): U {
    return this.items.reduce(fn, initial)
  }

  each(fn: (item: T, index: number) => void): this {
    this.items.forEach(fn)
    return this
  }

  tap(fn: (collection: this) => void): this {
    fn(this)
    return this
  }

  contains(fn: (item: T) => boolean): boolean {
    return this.items.some(fn)
  }

  pluck<K extends keyof T>(key: K): Collection<T[K]> {
    return new Collection(this.items.map(item => item[key]))
  }

  where<K extends keyof T>(key: K, value: T[K]): this {
    return this.filter(item => item[key] === value)
  }

  firstWhere<K extends keyof T>(key: K, value: T[K]): T | undefined {
    return this.first(item => item[key] === value)
  }

  keyBy<K extends keyof T>(key: K): Record<string, T> {
    const out: Record<string, T> = {}
    for (const item of this.items) out[String(item[key])] = item
    return out
  }

  groupBy<K extends keyof T>(key: K): Record<string, this> {
    const out: Record<string, T[]> = {}
    for (const item of this.items) {
      const k = String(item[key])
      ;(out[k] ??= []).push(item)
    }
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, this.newInstance(v)]))
  }

  sortBy(by: keyof T | ((item: T) => number | string)): this {
    const select = typeof by === 'function' ? by : (item: T) => item[by] as number | string
    return this.newInstance(
      [...this.items].sort((a, b) => {
        const av = select(a)
        const bv = select(b)
        return av < bv ? -1 : av > bv ? 1 : 0
      }),
    )
  }

  private numbers(by?: keyof T | ((item: T) => number)): number[] {
    const select
      = typeof by === 'function' ? by : by ? (i: T) => Number(i[by]) : (i: T) => Number(i)
    return this.items.map(select)
  }

  sum(by?: keyof T | ((item: T) => number)): number {
    return this.numbers(by).reduce((a, b) => a + b, 0)
  }

  avg(by?: keyof T | ((item: T) => number)): number {
    return this.isEmpty() ? 0 : this.sum(by) / this.count()
  }

  min(by?: keyof T | ((item: T) => number)): number {
    return Math.min(...this.numbers(by))
  }

  max(by?: keyof T | ((item: T) => number)): number {
    return Math.max(...this.numbers(by))
  }

  /** Fixed-size batches. Each batch keeps this collection's own type; the outer wrapper is a plain Collection (its elements are collections, not `T`). */
  chunk(size: number): Collection<this> {
    const out: this[] = []
    for (let i = 0; i < this.items.length; i += size) {
      out.push(this.newInstance(this.items.slice(i, i + size)))
    }
    return new Collection(out)
  }

  partition(fn: (item: T) => boolean): [this, this] {
    const pass: T[] = []
    const fail: T[] = []
    for (const item of this.items) (fn(item) ? pass : fail).push(item)
    return [this.newInstance(pass), this.newInstance(fail)]
  }

  /** Plain array, unwrapping model-aware items via their `toObject()`. */
  toArray(): unknown[] {
    return this.items.map((item) => {
      const obj = item as { toObject?(): unknown }
      return typeof obj?.toObject === 'function' ? obj.toObject() : item
    })
  }

  toJSON(): unknown[] {
    return this.toArray()
  }

  [Symbol.iterator](): Iterator<T> {
    return this.items[Symbol.iterator]()
  }
}
