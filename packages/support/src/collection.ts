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
  filter(fn: (item: T, index: number) => boolean): Collection<T> {
    return new Collection(this.items.filter(fn))
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
    return new Collection(this.items.map((item) => item[key]))
  }

  where<K extends keyof T>(key: K, value: T[K]): Collection<T> {
    return this.filter((item) => item[key] === value)
  }
  firstWhere<K extends keyof T>(key: K, value: T[K]): T | undefined {
    return this.first((item) => item[key] === value)
  }

  keyBy<K extends keyof T>(key: K): Record<string, T> {
    const out: Record<string, T> = {}
    for (const item of this.items) out[String(item[key])] = item
    return out
  }

  groupBy<K extends keyof T>(key: K): Record<string, Collection<T>> {
    const out: Record<string, T[]> = {}
    for (const item of this.items) {
      const k = String(item[key])
      ;(out[k] ??= []).push(item)
    }
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, new Collection(v)]))
  }

  sortBy(by: keyof T | ((item: T) => number | string)): Collection<T> {
    const select = typeof by === 'function' ? by : (item: T) => item[by] as number | string
    return new Collection(
      [...this.items].sort((a, b) => {
        const av = select(a)
        const bv = select(b)
        return av < bv ? -1 : av > bv ? 1 : 0
      }),
    )
  }

  private numbers(by?: keyof T | ((item: T) => number)): number[] {
    const select = typeof by === 'function' ? by : by ? (i: T) => Number(i[by]) : (i: T) => Number(i)
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

  chunk(size: number): Collection<Collection<T>> {
    const out: Collection<T>[] = []
    for (let i = 0; i < this.items.length; i += size) {
      out.push(new Collection(this.items.slice(i, i + size)))
    }
    return new Collection(out)
  }

  partition(fn: (item: T) => boolean): [Collection<T>, Collection<T>] {
    const pass: T[] = []
    const fail: T[] = []
    for (const item of this.items) (fn(item) ? pass : fail).push(item)
    return [new Collection(pass), new Collection(fail)]
  }

  /** Plain array, unwrapping model-aware items via their `toObject()`. */
  toArray(): unknown[] {
    return this.items.map((item) => {
      const obj = item as { toObject?: () => unknown }
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
