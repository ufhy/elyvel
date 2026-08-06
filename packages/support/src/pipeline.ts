/**
 * Pass a value through a chain of stages, each deciding whether to continue —
 * Laravel's `Pipeline`. It is the onion HTTP middleware is made of, offered as a
 * standalone tool: order processing (validate → reserve stock → charge → ship),
 * content filters, approval flows.
 *
 * What it buys over calling functions in sequence: a stage wraps everything
 * after it, so it can act on the way in AND the way out, short-circuit by not
 * calling `next`, or try/finally around the whole rest of the chain.
 *
 * ```ts
 * const order = await Pipeline.send(draft)
 *   .through([validate, reserveStock, charge])
 *   .then(finalize)
 * ```
 */

type Next<T> = (passable: T) => Promise<T>

/** A stage: a function, or an object with `handle` (a class instance works). */
export type Pipe<T> = ((passable: T, next: Next<T>) => T | Promise<T>) | { handle(passable: T, next: Next<T>): T | Promise<T> }

export class Pipeline<T> {
  private pipes: Pipe<T>[] = []

  private constructor(private readonly passable: T) {}

  /** Start a pipeline with the value that will travel through it. */
  static send<T>(passable: T): Pipeline<T> {
    return new Pipeline(passable)
  }

  /** The stages, in the order they run. Replaces any set before. */
  through(pipes: Pipe<T>[]): this {
    this.pipes = [...pipes]
    return this
  }

  /** Append stages — for building a chain conditionally. */
  pipe(...pipes: Pipe<T>[]): this {
    this.pipes.push(...pipes)
    return this
  }

  /**
   * Run the chain, ending in `destination`. Composed back to front, exactly as
   * middleware onions are: the first pipe ends up outermost, so it sees the
   * value first on the way in and last on the way out.
   */
  async then<R>(destination: (passable: T) => R | Promise<R>): Promise<R> {
    const run = this.pipes.reduceRight<Next<T | R>>(
      (next, pipe) => async (passable: T | R) => {
        const handler = typeof pipe === 'function' ? pipe : pipe.handle.bind(pipe)
        return handler(passable as T, next as Next<T>)
      },
      async (passable: T | R) => destination(passable as T) as Promise<T | R>,
    )
    return run(this.passable) as Promise<R>
  }

  /** Run the chain and return what falls out the end — `then(x => x)`. */
  thenReturn(): Promise<T> {
    return this.then(passable => passable)
  }
}
