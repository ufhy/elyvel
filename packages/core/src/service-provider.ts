import type { Application } from './application'

/**
 * A service provider is the unit of framework extension — the Elysia-first
 * equivalent of Laravel's service providers.
 *
 * `register()` runs first for *every* provider (bind things into the
 * container, but do not resolve other services yet). `boot()` runs afterwards
 * for every provider, once all bindings exist — the place to mount routes,
 * read config, or wire Elysia plugins.
 */
export abstract class ServiceProvider {
  constructor(protected readonly app: Application) {}

  /** Bind services into the container. Runs before any `boot()`. */
  register(): void | Promise<void> {}

  /** Perform startup work once all providers are registered. */
  boot(): void | Promise<void> {}
}

export type ServiceProviderClass = new (app: Application) => ServiceProvider
