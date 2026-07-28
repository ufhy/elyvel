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

type Extender<T> = (value: T, container: Container) => T

export class Container {
  private readonly bindings = new Map<string, Binding<unknown>>()
  private readonly instances = new Map<string, unknown>()
  private readonly extenders = new Map<string, Extender<unknown>[]>()

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

  /** Register a factory only if the token isn't already bound. */
  bindIf<T>(token: Token<T>, factory: Factory<T>): this {
    if (!this.has(token))
      this.bind(token, factory)
    return this
  }

  /** Register a lazy singleton only if the token isn't already bound. */
  singletonIf<T>(token: Token<T>, factory: Factory<T>): this {
    if (!this.has(token))
      this.singleton(token, factory)
    return this
  }

  /** Whether a token has been bound (as factory or instance). */
  has(token: Token<unknown>): boolean {
    return this.instances.has(token.key) || this.bindings.has(token.key)
  }

  /** Alias of {@link has} (Laravel naming). */
  bound(token: Token<unknown>): boolean {
    return this.has(token)
  }

  /** Remove a token's binding and cached instance. */
  forget(token: Token<unknown>): this {
    this.bindings.delete(token.key)
    this.instances.delete(token.key)
    return this
  }

  /** Clear all bindings and instances. */
  flush(): this {
    this.bindings.clear()
    this.instances.clear()
    this.extenders.clear()
    return this
  }

  /**
   * Wrap an already-bound value after it's resolved (Laravel's `extend`) —
   * e.g. decorate a logger, wrap a connection. For a `singleton`/`instance`
   * binding the decorator runs once (immediately if already resolved,
   * otherwise the next time it's built) and the wrapped value is cached; for
   * a plain `bind`, it runs fresh on every {@link make} since a fresh value
   * is produced every time anyway.
   */
  extend<T>(token: Token<T>, decorator: Extender<T>): this {
    const list = this.extenders.get(token.key) ?? []
    list.push(decorator as Extender<unknown>)
    this.extenders.set(token.key, list)
    if (this.instances.has(token.key)) {
      this.instances.set(token.key, decorator(this.instances.get(token.key) as T, this))
    }
    return this
  }

  /** Resolve a token to its value. Throws if the token was never bound. */
  make<T>(token: Token<T>): T {
    if (this.instances.has(token.key)) {
      return this.instances.get(token.key) as T
    }

    const binding = this.bindings.get(token.key)
    if (!binding) {
      throw new Error(
        `[elyvel] No binding registered for token "${token.key}". `
        + 'Did you forget to register its service provider?',
      )
    }

    let value = binding.factory(this)
    for (const decorate of this.extenders.get(token.key) ?? []) value = decorate(value, this)
    if (binding.singleton) {
      this.instances.set(token.key, value)
    }
    return value as T
  }
}
