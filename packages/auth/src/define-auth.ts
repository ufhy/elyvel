import type { BetterAuthOptions } from 'better-auth'
import { betterAuth } from 'better-auth'
import { eloquentAdapter } from './eloquent-adapter'

/**
 * `config/auth.ts` is authored with **native Better Auth options** — plugins
 * (incl. `twoFactor()`), `socialProviders`, `emailAndPassword`, etc. The
 * framework only fills in glue defaults (Eloquent adapter, APP_KEY secret, base
 * URL, cookie prefix, Eloquent-plural table names); everything you pass wins.
 */
export type DefineAuthOptions = Partial<BetterAuthOptions> & {
  /** Where to redirect a guest hitting a protected page (browser). Default `/login`. */
  loginPath?: string
  /** Where to redirect an unverified user (browser). Default `/verify-email`. */
  verifyPath?: string
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'app'
}

/**
 * Identity helper that pins the type of `config/auth.ts` — the auth counterpart
 * of `defineAppConfig`. Keeps the config file plain data (`export default
 * defineAuthConfig({...})`) so it lands in the config repository like every
 * other `config/*.ts`; the instance is built from it by {@link AuthServiceProvider}.
 */
export function defineAuthConfig(config: DefineAuthOptions): DefineAuthOptions {
  return config
}

/**
 * Build the app's Better Auth instance from native Better Auth options, layering
 * the framework glue underneath: the Eloquent adapter, a secret derived from
 * APP_KEY, the base URL, a per-app cookie prefix (slug of APP_NAME), and
 * Eloquent-plural core table names. Your options override every default.
 *
 * Table names use per-model `modelName` (respected by BOTH the adapter and
 * getSchema, so migrations and queries agree). Add features as plugins, e.g.
 * `plugins: [twoFactor()]` — nothing is forced on.
 */
export function defineAuth(options: DefineAuthOptions = {}): ReturnType<typeof betterAuth> {
  const appName = process.env.APP_NAME
  const cookiePrefix = appName ? slug(appName) : 'app'
  // loginPath/verifyPath are framework redirect targets (read by the auth guards
  // via `config('auth.*')`), NOT Better Auth options — keep them out of the instance.
  const { loginPath: _loginPath, verifyPath: _verifyPath, ...ba } = options

  return betterAuth({
    user: { modelName: 'users' },
    session: { modelName: 'sessions' },
    account: { modelName: 'accounts' },
    verification: { modelName: 'verifications' },
    database: eloquentAdapter(),
    // Session-signing secret — never ship a hardcoded fallback. The app already
    // refuses to boot without APP_KEY (cookie session driver), so this is set.
    secret: process.env.BETTER_AUTH_SECRET ?? process.env.APP_KEY,
    baseURL: process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
    ...ba,
    // Deep-merge the nested defaults so a partial override keeps the glue.
    emailAndPassword: { enabled: true, ...ba.emailAndPassword },
    emailVerification: { sendOnSignUp: true, ...ba.emailVerification },
    advanced: { cookiePrefix, ...ba.advanced },
  } as BetterAuthOptions)
}

/** Names of the social providers actually enabled — feeds the login/register UI. */
export function enabledSocialProviders(auth: ReturnType<typeof betterAuth>): string[] {
  return Object.keys(auth.options.socialProviders ?? {})
}
