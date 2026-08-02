/**
 * A registry of driver factories, with a door for drivers the framework has
 * never heard of — Laravel's `Illuminate\Support\Manager` and its `extend()`.
 *
 * Every subsystem here used to pick its implementation with a `switch` over a
 * driver name. The interfaces were right (`Transport`, `CacheStore`,
 * `SessionStore`, …), so anyone could write a driver, but there was no way to
 * register one: adding S3-compatible storage, Mailgun, or a WhatsApp channel
 * meant editing the framework. Built-ins go through the same door as everyone
 * else, so a third-party driver is never a second-class citizen.
 *
 * Composition rather than a base class: the nine call sites resolve their driver
 * from different shapes — `cfg.driver`, `cfg.transport`, a dialect, a bare config
 * object — and forcing them into one inheritance hierarchy would fit none of them
 * well. They each own a registry instead.
 */
export type DriverFactory<TDriver, TConfig> = (config: TConfig, name: string) => TDriver

export class DriverRegistry<TDriver, TConfig = unknown> {
  private readonly builtin = new Map<string, DriverFactory<TDriver, TConfig>>()
  private readonly custom = new Map<string, DriverFactory<TDriver, TConfig>>()

  /**
   * @param subject Named in error messages, e.g. `Mail transport`.
   * @param hint Appended to "not supported" errors — where to configure it.
   */
  constructor(
    private readonly subject: string,
    private readonly hint = '',
  ) {}

  /** Register a driver the framework ships. Called during setup, before use. */
  register(name: string, factory: DriverFactory<TDriver, TConfig>): this {
    this.builtin.set(name, factory)
    return this
  }

  /**
   * Register a driver from outside the framework — Laravel's `extend()`. Takes
   * precedence over a built-in of the same name, which is what makes it possible
   * to replace a shipped driver rather than only add to it.
   */
  extend(name: string, factory: DriverFactory<TDriver, TConfig>): this {
    this.custom.set(name, factory)
    return this
  }

  /** Is a driver of this name resolvable? */
  has(name: string): boolean {
    return this.custom.has(name) || this.builtin.has(name)
  }

  /** Every registered name, custom and built-in. */
  names(): string[] {
    return [...new Set([...this.builtin.keys(), ...this.custom.keys()])].sort()
  }

  /**
   * Build a driver. Throws when the name is unknown — naming the drivers that DO
   * exist, because the usual cause is a typo or a package the app forgot to
   * install, and both are invisible from the error otherwise.
   */
  resolve(name: string, config: TConfig): TDriver {
    const factory = this.custom.get(name) ?? this.builtin.get(name)
    if (!factory) {
      throw new Error(
        `[elyvel] ${this.subject} "${name}" is not supported. `
        + `Available: ${this.names().join(', ') || '(none registered)'}.${
          this.hint ? ` ${this.hint}` : ''}`,
      )
    }
    return factory(config, name)
  }

  /** Drop a custom registration. For tests that extend and must not leak. */
  forget(name: string): this {
    this.custom.delete(name)
    return this
  }
}
