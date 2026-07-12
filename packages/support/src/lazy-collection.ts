/**
 * A lazy, streaming collection over an async source — the Elysia-ravel take on
 * Laravel's `LazyCollection`. Nothing is materialized until iterated, so it
 * stays memory-bounded over large result sets (used by `Model.query().cursor()`).
 */
export class LazyCollection<T> implements AsyncIterable<T> {
  constructor(private readonly source: () => AsyncIterable<T>) {}

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this.source()[Symbol.asyncIterator]()
  }

  map<U>(fn: (item: T) => U): LazyCollection<U> {
    const source = this.source
    return new LazyCollection<U>(async function* () {
      for await (const item of source()) yield fn(item)
    })
  }

  filter(fn: (item: T) => boolean): LazyCollection<T> {
    const source = this.source
    return new LazyCollection<T>(async function* () {
      for await (const item of source()) if (fn(item)) yield item
    })
  }

  take(n: number): LazyCollection<T> {
    const source = this.source
    return new LazyCollection<T>(async function* () {
      if (n <= 0) return
      let taken = 0
      for await (const item of source()) {
        yield item
        if (++taken >= n) break
      }
    })
  }

  async each(fn: (item: T) => void | Promise<void>): Promise<void> {
    for await (const item of this) await fn(item)
  }

  async first(): Promise<T | undefined> {
    for await (const item of this) return item
    return undefined
  }

  async toArray(): Promise<T[]> {
    const out: T[] = []
    for await (const item of this) out.push(item)
    return out
  }
}
