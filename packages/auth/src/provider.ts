import type { Token } from '@elysia-ravel/core'
import type { DefineAuthOptions } from './define-auth'
import { config, ServiceProvider, token } from '@elysia-ravel/core'
import { defineAuth } from './define-auth'

/** The application's Better Auth instance, as built by {@link defineAuth}. */
export type AuthInstance = ReturnType<typeof defineAuth>

/** Container token for the Better Auth instance. Resolve via `app(AuthToken)`. */
export const AuthToken: Token<AuthInstance> = token<AuthInstance>('auth')

/**
 * Builds the Better Auth instance from `config/auth.ts` (read via the config
 * repository) and binds it as a lazy singleton — the auth counterpart of
 * `MailServiceProvider`/`EloquentServiceProvider`. Register it in `config/app.ts`.
 *
 * The binding is a lazy singleton (Laravel's `singleton(fn)` pattern): the
 * closure runs on first resolve, at request/run time — after every provider has
 * booted — so `config('auth')` is fully available. Consumers (the routes plugin,
 * the auth-tables migration) resolve it with `app(AuthToken)`.
 */
export class AuthServiceProvider extends ServiceProvider {
  override register(): void {
    this.app.container.singleton(AuthToken, () =>
      defineAuth(config<DefineAuthOptions>('auth', {})))
  }
}

/**
 * Whether `config/auth.ts` registers a Better Auth plugin with the given id —
 * e.g. `authHasPlugin('two-factor')`. Drives feature-gated routes and nav
 * without hard-coding a per-feature flag: it just inspects the plugin list.
 */
export function authHasPlugin(id: string): boolean {
  const plugins = config<Array<{ id?: string }>>('auth.plugins', []) ?? []
  return plugins.some(p => p?.id === id)
}
