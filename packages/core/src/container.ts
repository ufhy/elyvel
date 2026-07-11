/**
 * A lightweight, fully-typed service container.
 *
 * Unlike Laravel's string-keyed container (which relies on runtime magic and
 * loses type information), bindings here are keyed by a typed {@link Token}.
 * Resolving a token returns the exact type it was declared with — no casts,
 * no facades, no `any` leaking into userland.
 */

export interface Token<T> {
  readonly key: string
  /** Phantom field — carries the type, never assigned at runtime. */
  readonly _type?: T
}

/**
 * Create a typed token used to bind and resolve a value from the container.
 *
 * @example
 * const Db = token<Database>('db')
 * container.singleton(Db, () => new Database())
 * const db = container.make(Db) // typed as Database
 */
export function token<T>(key: string): Token<T> {
  return { key }
}

type Factory<T> = (container: Container) => T

interface Binding<T> {
  factory: Factory<T>
  singleton: boolean
}

export class Container {
  private readonly bindings = new Map<string, Binding<unknown>>()
  private readonly instances = new Map<string, unknown>()

  /** Register a factory. A new value is produced on every {@link make}. */
  bind<T>(token: Token<T>, factory: Factory<T>): this {
    this.bindings.set(token.key, { factory, singleton: false })
    return this
  }

  /** Register a factory resolved once, then cached (lazy singleton). */
  singleton<T>(token: Token<T>, factory: Factory<T>): this {
    this.bindings.set(token.key, { factory, singleton: true })
    return this
  }

  /** Register an already-constructed value as a singleton. */
  instance<T>(token: Token<T>, value: T): this {
    this.instances.set(token.key, value)
    return this
  }

  /** Whether a token has been bound (as factory or instance). */
  has(token: Token<unknown>): boolean {
    return this.instances.has(token.key) || this.bindings.has(token.key)
  }

  /** Resolve a token to its value. Throws if the token was never bound. */
  make<T>(token: Token<T>): T {
    if (this.instances.has(token.key)) {
      return this.instances.get(token.key) as T
    }

    const binding = this.bindings.get(token.key)
    if (!binding) {
      throw new Error(
        `[elysia-ravel] No binding registered for token "${token.key}". ` +
          'Did you forget to register its service provider?',
      )
    }

    const value = binding.factory(this)
    if (binding.singleton) {
      this.instances.set(token.key, value)
    }
    return value as T
  }
}
